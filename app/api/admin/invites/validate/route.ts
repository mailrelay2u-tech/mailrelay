import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

// Validate invite code (called before account creation)
export async function POST(req: NextRequest) {
  const { email, code } = await req.json()
  if (!email || !code) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('invite_codes')
    .select('id, email, used, expires_at')
    .eq('code', code)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Invalid invite code' }, { status: 400 })
  if (data.used) return NextResponse.json({ error: 'Invite code already used' }, { status: 400 })
  if (new Date(data.expires_at) < new Date()) return NextResponse.json({ error: 'Invite code expired' }, { status: 400 })
  if (data.email.toLowerCase() !== email.toLowerCase()) return NextResponse.json({ error: 'Email does not match invite' }, { status: 400 })

  // Get name from signup request
  const { data: req_ } = await supabase
    .from('signup_requests')
    .select('name')
    .eq('email', email)
    .single()

  return NextResponse.json({ ok: true, name: req_?.name ?? '' })
}

// Mark code as used (called after account creation)
export async function PATCH(req: NextRequest) {
  const { code } = await req.json()
  const supabase = await createServiceClient()
  await supabase.from('invite_codes').update({ used: true }).eq('code', code)
  return NextResponse.json({ ok: true })
}
