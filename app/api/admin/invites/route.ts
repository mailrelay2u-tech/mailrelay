import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendInviteCodeToAdmin } from '@/lib/email'
import { randomBytes } from 'crypto'

async function requireSuperAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: profile } = await supabase
    .from('profiles').select('role').eq('id', user.id).single()
  return profile?.role === 'superadmin' ? user : null
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const part = (n: number) => Array.from({ length: n }, () => chars[randomBytes(1)[0] % chars.length]).join('')
  return `${part(4)}-${part(4)}`
}

// Generate invite code for a signup request; code is emailed to the admin.
export async function POST(req: NextRequest) {
  const admin = await requireSuperAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { email, request_id, name } = await req.json()
  if (!email) return NextResponse.json({ error: 'Missing email' }, { status: 400 })

  const code = generateCode()
  const supabase = await createServiceClient()

  const { error } = await supabase.from('invite_codes').insert({ email, code })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (request_id) {
    await supabase.from('signup_requests').update({ status: 'approved' }).eq('id', request_id)
  }

  // Email the code to the admin, not the requester.
  try { await sendInviteCodeToAdmin(name || email, email, code) } catch {}

  return NextResponse.json({ ok: true, code })
}

export async function GET() {
  const admin = await requireSuperAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('invite_codes')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ codes: data })
}

export async function DELETE(req: NextRequest) {
  const admin = await requireSuperAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await req.json()
  const supabase = await createServiceClient()
  const { error } = await supabase.from('invite_codes').delete().eq('id', id).eq('used', false)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
