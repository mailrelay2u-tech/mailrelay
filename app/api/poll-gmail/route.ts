import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Orchestrator — runs in <2s, just fans out to per-account workers
// Each worker (poll-account) gets its own full 10s Vercel function budget
export const maxDuration = 10

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createServiceClient()

  const { data: accounts, error } = await supabase
    .from('gmail_accounts')
    .select('id, email')
    .eq('active', true)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!accounts?.length) return NextResponse.json({ ok: true, dispatched: 0 })

  // Build the base URL from the incoming request so it works on any domain
  // (localhost in dev, mailrelay-jet.vercel.app in prod)
  const base = `${req.nextUrl.protocol}//${req.nextUrl.host}`

  // Fire all per-account workers in parallel — do NOT await them
  // Each runs independently in its own Vercel function invocation
  accounts.forEach(account => {
    fetch(
      `${base}/api/poll-account?secret=${process.env.CRON_SECRET}&account_id=${account.id}`,
      { method: 'GET' }
    ).catch(() => {}) // fire-and-forget — errors handled inside poll-account
  })

  await supabase.from('app_state').upsert({
    key: 'last_checked',
    value: new Date().toISOString(),
  })

  return NextResponse.json({
    ok: true,
    dispatched: accounts.length,
    accounts: accounts.map(a => a.email),
  })
}
