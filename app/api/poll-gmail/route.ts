import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { pollAndForward } from '@/lib/gmail'

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  const { data: accounts, error } = await supabase
    .from('gmail_accounts')
    .select('id, email, app_password_encrypted, last_polled_at')
    .eq('active', true)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!accounts?.length) return NextResponse.json({ ok: true, dispatched: 0 })

  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const results = await Promise.all(accounts.map(async account => {
    const now = new Date().toISOString()

    try {
      const { data: rules } = await supabase
        .from('rules')
        .select('id, name, from_filter, subject_filter, account_id, rule_recipients(recipients(email))')
        .eq('account_id', account.id)
        .eq('active', true)

      const { data: recentLogs } = await supabase
        .from('forwarded_log')
        .select('message_id')
        .eq('account_id', account.id)
        .gte('forwarded_at', since7d.toISOString())
        .not('message_id', 'is', null)

      const alreadyForwarded = new Set<string>(
        (recentLogs ?? []).map((l: { message_id: string }) => l.message_id).filter(Boolean)
      )

      const formattedRules = (rules ?? []).map((r: Record<string, unknown>) => ({
        id: r.id as string,
        name: r.name as string,
        from_filter: r.from_filter as string | null,
        subject_filter: r.subject_filter as string | null,
        recipients: ((r.rule_recipients as Array<{ recipients: { email: string } }>) ?? [])
          .map(rr => rr.recipients?.email).filter(Boolean) as string[],
      }))

      // Cap sinceDate to 1h max to avoid scanning huge backlogs
      const max1h = new Date(Date.now() - 60 * 60 * 1000)
      const sinceDate = account.last_polled_at
        ? new Date(Math.max(new Date(account.last_polled_at).getTime(), max1h.getTime()))
        : max1h

      const forwarded = await pollAndForward(account, formattedRules, sinceDate, alreadyForwarded)

      if (forwarded.length > 0) {
        await supabase.from('forwarded_log').insert(
          forwarded.map(r => ({
            account_id: account.id,
            subject: r.subject,
            from_address: r.from,
            forwarded_to: r.recipients,
            rule_matched: r.ruleName,
            message_id: r.messageId,
          }))
        )
      }

      await supabase.from('gmail_accounts').update({
        last_polled_at: now,
        last_poll_status: 'ok',
      }).eq('id', account.id)

      return { account: account.email, ok: true, forwarded: forwarded.length }

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      const status = msg.includes('AUTHENTICATIONFAILED') || msg.includes('Invalid credentials') ||
        msg.includes('auth') || msg.includes('LOGIN') ? 'auth_error' : 'imap_error'

      await supabase.from('gmail_accounts').update({
        last_polled_at: now,
        last_poll_status: status,
      }).eq('id', account.id)

      return { account: account.email, ok: false, error: msg }
    }
  }))

  await supabase.from('app_state').upsert({
    key: 'last_checked',
    value: new Date().toISOString(),
  })

  return NextResponse.json({ ok: true, dispatched: accounts.length, results })
}
