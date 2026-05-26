import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { pollAndForward } from '@/lib/gmail'

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const accountId = req.nextUrl.searchParams.get('account_id')
  if (!accountId) return NextResponse.json({ error: 'Missing account_id' }, { status: 400 })

  const supabase = await createServiceClient()

  const { data: account } = await supabase
    .from('gmail_accounts')
    .select('id, email, app_password_encrypted, last_polled_at')
    .eq('id', accountId)
    .eq('active', true)
    .single()

  if (!account) return NextResponse.json({ ok: true, skipped: 'inactive or not found' })

  const { data: rules } = await supabase
    .from('rules')
    .select('id, name, from_filter, subject_filter, account_id, rule_recipients(recipients(email))')
    .eq('account_id', accountId)
    .eq('active', true)

  // Use last_polled_at as the since date so no emails are missed between polls.
  // Fall back to 24h ago if never polled before.
  const sinceDate = account.last_polled_at
    ? new Date(account.last_polled_at)
    : new Date(Date.now() - 24 * 60 * 60 * 1000)
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

  const { data: recentLogs } = await supabase
    .from('forwarded_log')
    .select('message_id')
    .eq('account_id', accountId)
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

  const now = new Date().toISOString()

  try {
    const results = await pollAndForward(account, formattedRules, sinceDate, alreadyForwarded)

    if (results.length > 0) {
      await supabase.from('forwarded_log').insert(
        results.map(r => ({
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
    }).eq('id', accountId)

    await supabase.from('app_state').upsert({ key: 'last_checked', value: now })

    return NextResponse.json({ ok: true, forwarded: results.length })

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    const status = msg.includes('AUTHENTICATIONFAILED') || msg.includes('Invalid credentials') ||
      msg.includes('auth') || msg.includes('LOGIN') ? 'auth_error' : 'imap_error'

    await supabase.from('gmail_accounts').update({
      last_polled_at: now,
      last_poll_status: status,
    }).eq('id', accountId)

    return NextResponse.json({ ok: false, error: msg })
  }
}
