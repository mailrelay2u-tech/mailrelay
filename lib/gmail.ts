import { ImapFlow } from 'imapflow'
import { decrypt } from './crypto'
import { transporter } from './email'

export interface GmailAccount {
  id: string
  email: string
  app_password_encrypted: string
}

export interface Rule {
  id: string
  name: string
  from_filter: string | null
  subject_filter: string | null
  recipients: string[]
}

export interface ForwardResult {
  subject: string
  from: string
  ruleName: string
  recipients: string[]
  messageId: string
}

/**
 * Opens an IMAP IDLE connection for `idleMs` milliseconds.
 * Any new unseen message that arrives during that window is immediately
 * matched against rules and forwarded. Returns all forwarded results.
 *
 * On Vercel (60s max function duration) call with idleMs = 55_000.
 * Locally or on a long-running server you can pass a larger value.
 */
export async function idleAndForward(
  account: GmailAccount,
  rules: Rule[],
  idleMs = 55_000
): Promise<ForwardResult[]> {
  const password = decrypt(account.app_password_encrypted)

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: account.email, pass: password },
    logger: false,
  })

  await client.connect()
  const results: ForwardResult[] = []

  try {
    const lock = await client.getMailboxLock('INBOX')
    try {
      // --- Step 1: catch up on any unseen mail since last check ---
      // This handles emails that arrived between cron invocations
      const catchUpSince = new Date(Date.now() - 70_000) // 70s back covers the 1-min cron gap
      await processUnseen(client, rules, results, catchUpSince)

      // --- Step 2: IDLE — wait for server PUSH notifications ---
      // Gmail will push EXISTS/RECENT when new mail arrives
      const idleStart = Date.now()
      let idleHandle: ReturnType<typeof client.idle> | null = null

      await new Promise<void>((resolve) => {
        // Set a hard timeout to exit IDLE before Vercel kills the function
        const timeout = setTimeout(() => {
          resolve()
        }, idleMs)

        // Listen for new mail notifications from the server
        client.on('exists', async () => {
          // New mail arrived — process it immediately
          await processUnseen(client, rules, results, new Date(idleStart))
        })

        // Start IDLE
        idleHandle = client.idle()
        idleHandle.catch(() => {}) // suppress unhandled rejection if we stop early

        // If IDLE ends on its own (server timeout ~29min), resolve
        if (idleHandle) {
          Promise.resolve(idleHandle).then(() => {
            clearTimeout(timeout)
            resolve()
          }).catch(() => {
            clearTimeout(timeout)
            resolve()
          })
        }
      })

      // Stop IDLE cleanly
      if (idleHandle) {
        try { await (idleHandle as unknown as { stop: () => void }).stop?.() } catch {}
      }

    } finally {
      lock.release()
    }
  } finally {
    try { await client.logout() } catch {}
  }

  return results
}

/**
 * Fetch all unseen messages since `since`, match rules, forward matches.
 * Deduplicates by Message-ID so the same email is never forwarded twice.
 */
async function processUnseen(
  client: ImapFlow,
  rules: Rule[],
  results: ForwardResult[],
  since: Date
) {
  const seenIds = new Set(results.map(r => r.messageId))

  const messages = client.fetch(
    { since, seen: false },
    { envelope: true, source: true, headers: ['message-id'] }
  )

  for await (const msg of messages) {
    const subject = msg.envelope?.subject || ''
    const from = msg.envelope?.from?.[0]?.address || ''
    const messageId = msg.envelope?.messageId || `${msg.uid}`

    // Skip if already forwarded in this session
    if (seenIds.has(messageId)) continue

    for (const rule of rules) {
      const fromMatch = !rule.from_filter ||
        from.toLowerCase().includes(rule.from_filter.toLowerCase())
      const subjectMatch = !rule.subject_filter ||
        subject.toLowerCase().includes(rule.subject_filter.toLowerCase())

      if (fromMatch && subjectMatch && rule.recipients.length > 0) {
        const raw = msg.source?.toString() ?? ''

        await transporter.sendMail({
          from: `MailRelay <${process.env.SMTP_USER}>`,
          to: rule.recipients,
          subject: `[Fwd] ${subject}`,
          html: `
            <p style="color:#666;font-size:13px;border-left:3px solid #4B6BF1;padding-left:10px;margin-bottom:16px">
              Forwarded by <strong>MailRelay</strong> · Rule: <em>${rule.name}</em><br/>
              Original sender: <strong>${from}</strong>
            </p>
          `,
          attachments: [{ filename: 'original.eml', content: raw }],
        })

        results.push({ subject, from, ruleName: rule.name, recipients: rule.recipients, messageId })
        seenIds.add(messageId)
        break // first matching rule wins
      }
    }
  }
}

/**
 * Legacy poll fallback — used when IDLE is not needed (e.g. testing).
 * Kept for backward compatibility with the cron route.
 */
export async function pollAccount(
  account: GmailAccount,
  rules: Rule[]
): Promise<ForwardResult[]> {
  return idleAndForward(account, rules, 0) // 0ms IDLE = catch-up only, no wait
}
