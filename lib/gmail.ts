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
 * Connect to Gmail IMAP, fetch all messages since `sinceDate`,
 * match against rules, forward matches via SMTP.
 *
 * Uses INTERNALDATE (server receive time) not the Seen flag —
 * so it works even if the user has already read the email in Gmail.
 *
 * Deduplication is handled by the caller via already-forwarded Message-IDs
 * stored in the database (passed in as `alreadyForwarded`).
 */
export async function pollAndForward(
  account: GmailAccount,
  rules: Rule[],
  sinceDate: Date,
  alreadyForwarded: Set<string>
): Promise<ForwardResult[]> {
  const password = decrypt(account.app_password_encrypted)

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: account.email, pass: password },
    logger: false,
    // Shorter timeouts so we fail fast on bad credentials
    socketTimeout: 5000,
    greetingTimeout: 5000,
  })

  await client.connect()
  const results: ForwardResult[] = []

  // Poll INBOX and Spam only — never All Mail (contains sent items which causes loops)
  const folders = ['INBOX', '[Gmail]/Spam']
  // Max emails to process per folder per cycle — prevents timeout on large inboxes
  const BATCH_SIZE = 25

  try {
    for (const folder of folders) {
      let lock
      try { lock = await client.getMailboxLock(folder) } catch { continue }

      try {
        const uids = await client.search({ since: sinceDate }, { uid: true })
        const uidList = Array.isArray(uids) ? uids : []
        if (!uidList.length) continue

        // Take only the NEWEST batch — UIDs are ascending so slice from end
        const batchUids = uidList.slice(-BATCH_SIZE)

        const messages = client.fetch(batchUids, { envelope: true, source: true }, { uid: true })

        for await (const msg of messages) {
          const subject = msg.envelope?.subject || ''
          const from = msg.envelope?.from?.[0]?.address || ''
          const messageId = msg.envelope?.messageId || `uid-${msg.uid}`

          if (alreadyForwarded.has(messageId)) continue

          // Skip emails sent BY this account (our own forwarded copies)
          if (from.toLowerCase() === account.email.toLowerCase()) continue

          for (const rule of rules) {
            const fromMatch = !rule.from_filter ||
              from.toLowerCase().includes(rule.from_filter.toLowerCase())
            const subjectMatch = !rule.subject_filter ||
              subject.toLowerCase().includes(rule.subject_filter.toLowerCase())

            if (fromMatch && subjectMatch && rule.recipients.length > 0) {
              const raw = msg.source?.toString() ?? ''
              const bodyHtml = extractHtmlBody(raw)
              const bodyText = extractPlainBody(raw)

              // Use HTML body as-is if present (already valid HTML)
              // For plain text, wrap in <pre> but do NOT double-escape —
              // the text is already decoded from quoted-printable/base64
              const bodyContent = bodyHtml
                ? bodyHtml
                : `<pre style="white-space:pre-wrap;font-family:inherit;margin:0">${escapeHtml(bodyText)}</pre>`

              await transporter.sendMail({
                from: `MailRelay <${process.env.SMTP_USER}>`,
                to: rule.recipients,
                replyTo: from,
                subject: `[Fwd] ${subject}`,
                headers: {
                  'X-Forwarded-From': from,
                  'X-Forwarded-By': 'MailRelay',
                  'X-Original-Subject': subject,
                },
                html: `
                  <div style="font-family:sans-serif;max-width:680px;margin:0 auto">
                    <div style="background:#4B6BF1;padding:12px 20px;border-radius:8px 8px 0 0;display:flex;align-items:center;justify-content:space-between">
                      <div>
                        <span style="color:white;font-weight:bold;font-size:15px">MailRelay</span>
                        <span style="color:#c7d2fe;font-size:13px;margin-left:8px">Forwarded Email</span>
                      </div>
                      <a href="mailto:${from}" style="color:#c7d2fe;font-size:12px;text-decoration:none;border:1px solid rgba(255,255,255,0.3);padding:4px 10px;border-radius:6px">Reply to sender</a>
                    </div>
                    <div style="border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:20px">
                      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:13px;background:#f9fafb;border-radius:8px;padding:12px">
                        <tr><td style="color:#6b7280;padding:4px 8px;width:80px">From</td><td style="color:#111827;font-weight:600;padding:4px 8px">${from}</td></tr>
                        <tr><td style="color:#6b7280;padding:4px 8px">Subject</td><td style="color:#111827;font-weight:600;padding:4px 8px">${subject}</td></tr>
                        <tr><td style="color:#6b7280;padding:4px 8px">Via rule</td><td style="color:#4B6BF1;padding:4px 8px">${rule.name}</td></tr>
                        <tr><td style="color:#6b7280;padding:4px 8px">To</td><td style="color:#111827;padding:4px 8px">${rule.recipients.join(', ')}</td></tr>
                      </table>
                      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0"/>
                      <div style="font-size:14px;color:#374151;line-height:1.6">
                        ${bodyContent}
                      </div>
                    </div>
                    <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:12px">
                      Forwarded by <a href="https://mailrelay-jet.vercel.app" style="color:#9ca3af">MailRelay</a> · Original .eml attached · <a href="mailto:${from}" style="color:#9ca3af">Reply to ${from}</a>
                    </p>
                  </div>
                `,
                attachments: [],
              })

              results.push({ subject, from, ruleName: rule.name, recipients: rule.recipients, messageId })
              alreadyForwarded.add(messageId)
              break
            }
          }
        }
      } finally {
        lock.release()
      }
    }
  } finally {
    try { await client.logout() } catch {}
  }

  return results
}

// Keep old export name for any other callers
export const idleAndForward = pollAndForward

// ---------------------------------------------------------------------------
// Body extraction helpers
// ---------------------------------------------------------------------------

function extractPlainBody(raw: string): string {
  if (!raw) return ''
  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i)
  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim()
    const parts = raw.split(new RegExp(`--${escapeRegex(boundary)}(?:--)?`))
    for (const part of parts) {
      if (/content-type:\s*text\/plain/i.test(part)) return decodeBody(part)
    }
  }
  const blankLine = raw.indexOf('\r\n\r\n')
  if (blankLine !== -1) return raw.slice(blankLine + 4).trim()
  const blankLineN = raw.indexOf('\n\n')
  if (blankLineN !== -1) return raw.slice(blankLineN + 2).trim()
  return raw
}

function extractHtmlBody(raw: string): string {
  if (!raw) return ''
  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i)
  if (boundaryMatch) {
    const boundary = boundaryMatch[1].trim()
    const parts = raw.split(new RegExp(`--${escapeRegex(boundary)}(?:--)?`))
    for (const part of parts) {
      if (/content-type:\s*text\/html/i.test(part)) return decodeBody(part)
    }
  }
  return ''
}

function decodeBody(part: string): string {
  const blankLine = part.indexOf('\r\n\r\n')
  const blankLineN = part.indexOf('\n\n')
  const bodyStart = blankLine !== -1 ? blankLine + 4 : blankLineN !== -1 ? blankLineN + 2 : 0
  let body = part.slice(bodyStart).trim()

  if (/content-transfer-encoding:\s*quoted-printable/i.test(part)) {
    body = body
      .replace(/=\r\n/g, '')      // soft line break CRLF
      .replace(/=\n/g, '')        // soft line break LF
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => {
        const code = parseInt(hex, 16)
        return String.fromCharCode(code)
      })
    // Re-encode latin1 bytes as UTF-8 if charset is UTF-8
    if (/charset\s*=\s*["']?utf-8/i.test(part)) {
      try { body = Buffer.from(body, 'latin1').toString('utf8') } catch {}
    }
  }

  if (/content-transfer-encoding:\s*base64/i.test(part)) {
    try { body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf8') } catch {}
  }

  return body
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
