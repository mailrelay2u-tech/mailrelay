import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { pollAndForward } from '@/lib/gmail'

export const maxDuration = 10

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  // Load all active accounts
  const { data: accounts, error: accErr } = await supabase
    .from('gmail_accounts')
    .select('id, email, app_password_encrypted')
    .eq('active', true)

  if (accErr) return NextResponse.json({ error: accErr.message }, { status: 500 })
  if (!accounts?.length) return NextResponse.json({ ok: true, polled: 0, forwarded: 0 })

  const accountIds = accounts.map(a => a.id)

  // Load active rules with recipients
  const { data: allRules } = await supabase
    .from('rules')
    .select('id, name, from_filter, subject_filter, account_id, rule_recipients(recipients(email))')
    .in('account_id', accountIds)
    .eq('active', true)

  // Load message IDs already forwarded in the last 2 hours (deduplication)
  const since2h = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const { data: recentLogs } = await supabase
    .from('forwarded_log')
    .select('message_id')
    .in('account_id', accountIds)
    .gte('forwarded_at', since2h)
    .not('message_id', 'is', null)

  const alreadyForwarded = new Set<string>(
    (recentLogs ?? []).map((l: { message_id: string }) => l.message_id).filter(Boolean)
  )

  // Group rules by account
  const rulesByAccount = new Map<string, ReturnType<typeof formatRules>>()
  for (const accountId of accountIds) {
    rulesByAccount.set(
      accountId,
      formatRules((allRules ?? []).filter((r: Record<string, unknown>) => r.account_id === accountId))
    )
  }

  // Poll window: 2 hours back — catches emails even if the cron was delayed
  // or the user opened the email in Gmail before the poll ran
  const sinceDate = new Date(Date.now() - 2 * 60 * 60 * 1000)

  const now = new Date().toISOString()
  let totalForwarded = 0
  const errors: string[] = []

  // Poll all accounts sequentially to stay within 10s Hobby limit
  for (const account of accounts) {
    const rules = rulesByAccount.get(account.id) ?? []

    try {
      const results = await pollAndForward(account, rules, sinceDate, alreadyForwarded)

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
        totalForwarded += results.length
      }

      await supabase.from('gmail_accounts').update({
        last_polled_at: now,
        last_poll_status: 'ok',
      }).eq('id', account.id)

    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${account.email}: ${msg}`)

      const status =
        msg.includes('AUTHENTICATIONFAILED') ||
        msg.includes('Invalid credentials') ||
        msg.includes('auth') ||
        msg.includes('LOGIN')
          ? 'auth_error'
          : 'imap_error'

      await supabase.from('gmail_accounts').update({
        last_polled_at: now,
        last_poll_status: status,
      }).eq('id', account.id)
    }
  }

  await supabase.from('app_state').upsert({ key: 'last_checked', value: now })

  return NextResponse.json({
    ok: true,
    polled: accounts.length,
    forwarded: totalForwarded,
    errors: errors.length ? errors : undefined,
  })
}

function formatRules(rules: Record<string, unknown>[]) {
  return rules.map(r => ({
    id: r.id as string,
    name: r.name as string,
    from_filter: r.from_filter as string | null,
    subject_filter: r.subject_filter as string | null,
    recipients: ((r.rule_recipients as Array<{ recipients: { email: string } }>) ?? [])
      .map(rr => rr.recipients?.email)
      .filter(Boolean) as string[],
  }))
}
