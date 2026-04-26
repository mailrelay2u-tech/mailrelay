import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

async function getUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accountId = req.nextUrl.searchParams.get('account_id')
  const supabase = await createServiceClient()

  let query = supabase
    .from('rules')
    .select(`id, name, active, from_filter, subject_filter, account_id,
      gmail_accounts(email, label),
      rule_recipients(recipient_id, recipients(id, name, email))`)
    .order('created_at', { ascending: false })

  if (accountId) query = query.eq('account_id', accountId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rules = (data ?? []).map((r: Record<string, unknown>) => ({
    ...r,
    account_email: (r.gmail_accounts as { email: string; label: string } | null)?.email ?? null,
    account_label: (r.gmail_accounts as { email: string; label: string } | null)?.label ?? null,
    recipients: ((r.rule_recipients as Array<{ recipients: unknown }>) ?? []).map((rr) => rr.recipients),
  }))

  return NextResponse.json({ rules })
}

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { account_id, name, from_filter, subject_filter, recipient_ids } = await req.json()
  if (!account_id || !name) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const supabase = await createServiceClient()
  const { data: rule, error } = await supabase
    .from('rules')
    .insert({ account_id, name, from_filter: from_filter || null, subject_filter: subject_filter || null })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (recipient_ids?.length) {
    await supabase.from('rule_recipients').insert(
      recipient_ids.map((rid: string) => ({ rule_id: rule.id, recipient_id: rid }))
    )
  }

  return NextResponse.json({ ok: true })
}

export async function PATCH(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, recipient_ids, ...rest } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const supabase = await createServiceClient()

  if (Object.keys(rest).length) {
    const { error } = await supabase.from('rules').update(rest).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (recipient_ids !== undefined) {
    await supabase.from('rule_recipients').delete().eq('rule_id', id)
    if (recipient_ids.length) {
      await supabase.from('rule_recipients').insert(
        recipient_ids.map((rid: string) => ({ rule_id: id, recipient_id: rid }))
      )
    }
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  const supabase = await createServiceClient()
  const { error } = await supabase.from('rules').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
