import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

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

  // On Render, await all accounts directly — no Vercel function timeout constraints
  const results = await Promise.all(
    accounts.map(account =>
      fetch(
        `${base}/api/poll-account?secret=${process.env.CRON_SECRET}&account_id=${account.id}`,
        { method: 'GET' }
      ).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))
    )
  )

  await supabase.from('app_state').upsert({
    key: 'last_checked',
    value: new Date().toISOString(),
  })

  return NextResponse.json({
    ok: true,
    dispatched: accounts.length,
    accounts: accounts.map(a => a.email),
    results,
  })
}
