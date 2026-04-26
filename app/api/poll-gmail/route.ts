import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { idleAndForward } from '@/lib/gmail'

// Vercel Hobby plan max is 10s
export const maxDuration = 10

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  const { data: accounts } = await supabase
    .from('gmail_accounts')
    .select('id, email, app_password_encrypted')
    .eq('active', true)

  if (!accounts?.length) {
    return NextResponse.json({ ok: true, polled: 0, forwarded: 0 })
  }

  // Load rules for all accounts in one query
  const accountIds = accounts.map(a => a.id)
  const { data: allRules } = await supabase
    .from('rules')
    .select(`id, name, from_filter, subject_filter, account_id,
      rule_recipients(recipients(email))`)
    .in('account_id', accountIds)
    .eq('active', true)

  // Group rules by account_id
  const rulesByAccount = new Map<string, ReturnType<typeof formatRules>>()
  for (const accountId of accountIds) {
    const accountRules = (allRules ?? []).filter(
      (r: Record<string, unknown>) => r.account_id === accountId
    )
    rulesByAccount.set(accountId, formatRules(accountRules))
  }

  // Vercel Hobby: 10s max function duration
  // 8s IDLE + ~2s for connect/disconnect/DB = safely under 10s
  const IDLE_MS = 8_000

  const accountResults = await Promise.allSettled(
    accounts.map(account =>
      idleAndForward(account, rulesByAccount.get(account.id) ?? [], IDLE_MS)
        .then(results => ({ account, results, error: null }))
        .catch(err => ({ account, results: [], error: err instanceof Error ? err.message : 'unknown' }))
    )
  )

  let totalForwarded = 0
  const now = new Date().toISOString()

  for (const settled of accountResults) {
    if (settled.status === 'rejected') continue
    const { account, results, error } = settled.value

    if (error) {
      const status = error.includes('auth') || error.includes('LOGIN') || error.includes('AUTHENTICATIONFAILED')
        ? 'auth_error'
        : 'imap_error'
      await supabase.from('gmail_accounts').update({
        last_polled_at: now,
        last_poll_status: status,
      }).eq('id', account.id)
      continue
    }

    if (results.length > 0) {
      await supabase.from('forwarded_log').insert(
        results.map(r => ({
          account_id: account.id,
          subject: r.subject,
          from_address: r.from,
          forwarded_to: r.recipients,
          rule_matched: r.ruleName,
        }))
      )
      totalForwarded += results.length
    }

    await supabase.from('gmail_accounts').update({
      last_polled_at: now,
      last_poll_status: 'ok',
    }).eq('id', account.id)
  }

  await supabase.from('app_state').upsert({
    key: 'last_checked',
    value: now,
  })

  return NextResponse.json({
    ok: true,
    polled: accounts.length,
    forwarded: totalForwarded,
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
