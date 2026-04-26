import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { ImapFlow } from 'imapflow'
import { decrypt } from '@/lib/crypto'

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  const { data: accounts } = await supabase
    .from('gmail_accounts')
    .select('id, email, app_password_encrypted, active')

  const { data: allRules } = await supabase
    .from('rules')
    .select('id, name, from_filter, subject_filter, account_id, active, rule_recipients(recipients(email))')

  const report: Record<string, unknown>[] = []

  for (const account of accounts ?? []) {
    const accountRules = (allRules ?? [])
      .filter((r: Record<string, unknown>) => r.account_id === account.id)
      .map((r: Record<string, unknown>) => ({
        id: r.id,
        name: r.name,
        active: r.active,
        from_filter: r.from_filter,
        subject_filter: r.subject_filter,
        recipients: ((r.rule_recipients as Array<{ recipients: { email: string } }>) ?? [])
          .map(rr => rr.recipients?.email).filter(Boolean),
      }))

    const accountReport: Record<string, unknown> = {
      account: account.email,
      active: account.active,
      rules: accountRules,
      imap: null,
      folders_checked: [] as string[],
      emails_found: [],
      error: null,
    }

    try {
      const password = decrypt(account.app_password_encrypted)
      const client = new ImapFlow({
        host: 'imap.gmail.com',
        port: 993,
        secure: true,
        auth: { user: account.email, pass: password },
        logger: false,
        socketTimeout: 8000,
        greetingTimeout: 8000,
      })

      await client.connect()
      accountReport.imap = 'connected'

      try {
        // List all available mailboxes
        const mailboxList = await client.list()
        const mailboxes = mailboxList.map((mb: { path: string }) => mb.path)
        accountReport.available_folders = mailboxes

        // Check these folders in order — stop when we find emails
        const foldersToCheck = [
          'INBOX',
          '[Gmail]/All Mail',
          '[Gmail]/Spam',
          'All Mail',
          'Spam',
        ].filter(f => mailboxes.includes(f))

        accountReport.folders_checked = foldersToCheck

        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // 7 days back
        accountReport.search_since = since.toISOString()

        const allEmails: Record<string, unknown>[] = []

        for (const folder of foldersToCheck) {
          const lock = await client.getMailboxLock(folder)
          try {
            const uids = await client.search({ since }, { uid: true })
            const uidList = Array.isArray(uids) ? uids : []

            if (uidList.length > 0) {
              const fetchUids = uidList.slice(-20)
              const messages = client.fetch(fetchUids, { envelope: true }, { uid: true })

              for await (const msg of messages) {
                const subject = msg.envelope?.subject || ''
                const from = msg.envelope?.from?.[0]?.address || ''
                const messageId = msg.envelope?.messageId || `uid-${msg.uid}`
                const date = msg.envelope?.date?.toISOString() || ''

                const matchedRules = accountRules
                  .filter(r => r.active)
                  .filter(r => {
                    const fromMatch = !r.from_filter ||
                      from.toLowerCase().includes((r.from_filter as string).toLowerCase())
                    const subjectMatch = !r.subject_filter ||
                      subject.toLowerCase().includes((r.subject_filter as string).toLowerCase())
                    return fromMatch && subjectMatch
                  })
                  .map(r => r.name)

                allEmails.push({
                  folder,
                  uid: msg.uid,
                  date,
                  from,
                  subject,
                  messageId,
                  matched_rules: matchedRules,
                  would_forward: matchedRules.length > 0,
                })
              }
            }
          } finally {
            lock.release()
          }
        }

        accountReport.emails_found = allEmails
        accountReport.total_emails_scanned = allEmails.length
        accountReport.would_forward_count = allEmails.filter(e => e.would_forward).length

      } finally {
        await client.logout()
      }

    } catch (err: unknown) {
      accountReport.imap = 'error'
      accountReport.error = err instanceof Error ? err.message : String(err)
    }

    report.push(accountReport)
  }

  return NextResponse.json({ report }, { status: 200 })
}
