import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { sendAdminNotification } from '@/lib/email'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user ?? null
}

// Public: submit signup request
export async function POST(req: NextRequest) {
  const { name, email } = await req.json()
  if (!name || !email) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const supabase = await createServiceClient()
  const { error } = await supabase.from('signup_requests').insert({ name, email })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try { await sendAdminNotification(name, email) } catch {}

  return NextResponse.json({ ok: true })
}

// Admin: list requests
export async function GET() {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('signup_requests')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ requests: data })
}

// Admin: approve/reject
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id, action } = await req.json()
  const supabase = await createServiceClient()
  const { error } = await supabase
    .from('signup_requests')
    .update({ status: action === 'approve' ? 'approved' : 'rejected' })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
