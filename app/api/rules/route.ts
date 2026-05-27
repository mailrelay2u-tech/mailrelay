import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

async function getUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

async function getOwnedAccountIds(supabase: Awaited<ReturnType<typeof createServiceClient>>, userId: string) {
  const { data, error } = await supabase
    .from('gmail_accounts')
    .select('id')
    .eq('user_id', userId)

  if (error) throw new Error(error.message)
  return (data ?? []).map((account: { id: string }) => account.id)
}

async function getOwnedRecipientIdSet(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  userId: string,
  recipientIds?: string[]
) {
  let query = supabase
    .from('recipients')
    .select('id')
    .eq('user_id', userId)

  if (recipientIds) query = query.in('id', recipientIds)

  const { data, error } = await query
  if (error) throw new Error(error.message)

  return new Set((data ?? []).map((recipient: { id: string }) => recipient.id))
}

function normalizeRecipientIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0))]
}

function isOwnedRule(rule: { account_id: string } | null, accountIds: string[]) {
  return Boolean(rule && accountIds.includes(rule.account_id))
}

export async function GET(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accountId = req.nextUrl.searchParams.get('account_id')
  const supabase = await createServiceClient()

  try {
    const accountIds = await getOwnedAccountIds(supabase, user.id)
    if (!accountIds.length) return NextResponse.json({ rules: [] })
    if (accountId && !accountIds.includes(accountId)) return NextResponse.json({ rules: [] })

    const ownedRecipientIds = await getOwnedRecipientIdSet(supabase, user.id)
    const ruleAccountIds = accountId ? [accountId] : accountIds

    const { data, error } = await supabase
      .from('rules')
      .select(`id, name, active, from_filter, subject_filter, account_id,
        gmail_accounts(email, label),
        rule_recipients(recipient_id, recipients(id, name, email))`)
      .in('account_id', ruleAccountIds)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rules = (data ?? []).map((r: Record<string, unknown>) => {
      const recipients = ((r.rule_recipients as Array<{ recipients: unknown }>) ?? [])
        .map((rr) => rr.recipients as { id?: string } | null)
        .filter((recipient) => recipient?.id && ownedRecipientIds.has(recipient.id))

      return {
        ...r,
        account_email: (r.gmail_accounts as { email: string; label: string } | null)?.email ?? null,
        account_label: (r.gmail_accounts as { email: string; label: string } | null)?.label ?? null,
        recipients,
      }
    })

    return NextResponse.json({ rules })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { account_id, name, from_filter, subject_filter, recipient_ids } = await req.json()
  if (!account_id || !name) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const supabase = await createServiceClient()

  try {
    const accountIds = await getOwnedAccountIds(supabase, user.id)
    if (!accountIds.includes(account_id)) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }

    const cleanRecipientIds = normalizeRecipientIds(recipient_ids)
    const ownedRecipientIds = await getOwnedRecipientIdSet(supabase, user.id, cleanRecipientIds)
    if (ownedRecipientIds.size !== cleanRecipientIds.length) {
      return NextResponse.json({ error: 'One or more recipients were not found' }, { status: 404 })
    }

    const { data: rule, error } = await supabase
      .from('rules')
      .insert({ account_id, name, from_filter: from_filter || null, subject_filter: subject_filter || null })
      .select('id')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (cleanRecipientIds.length) {
      const { error: recipientsError } = await supabase.from('rule_recipients').insert(
        cleanRecipientIds.map((rid: string) => ({ rule_id: rule.id, recipient_id: rid }))
      )

      if (recipientsError) return NextResponse.json({ error: recipientsError.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, recipient_ids, ...rest } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const supabase = await createServiceClient()

  try {
    const accountIds = await getOwnedAccountIds(supabase, user.id)
    const { data: existingRule, error: ruleError } = await supabase
      .from('rules')
      .select('id, account_id')
      .eq('id', id)
      .maybeSingle()

    if (ruleError) return NextResponse.json({ error: ruleError.message }, { status: 500 })
    if (!isOwnedRule(existingRule, accountIds)) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}
    if ('name' in rest) updates.name = rest.name
    if ('active' in rest) updates.active = rest.active
    if ('from_filter' in rest) updates.from_filter = rest.from_filter || null
    if ('subject_filter' in rest) updates.subject_filter = rest.subject_filter || null
    if ('account_id' in rest) {
      if (!accountIds.includes(rest.account_id)) {
        return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      }
      updates.account_id = rest.account_id
    }

    if (Object.keys(updates).length) {
      const { error } = await supabase.from('rules').update(updates).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (recipient_ids !== undefined) {
      const cleanRecipientIds = normalizeRecipientIds(recipient_ids)
      const ownedRecipientIds = await getOwnedRecipientIdSet(supabase, user.id, cleanRecipientIds)
      if (ownedRecipientIds.size !== cleanRecipientIds.length) {
        return NextResponse.json({ error: 'One or more recipients were not found' }, { status: 404 })
      }

      const { error: deleteError } = await supabase.from('rule_recipients').delete().eq('rule_id', id)
      if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

      if (cleanRecipientIds.length) {
        const { error: insertError } = await supabase.from('rule_recipients').insert(
          cleanRecipientIds.map((rid: string) => ({ rule_id: id, recipient_id: rid }))
        )
        if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const user = await getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const supabase = await createServiceClient()

  try {
    const accountIds = await getOwnedAccountIds(supabase, user.id)
    const { data: existingRule, error: ruleError } = await supabase
      .from('rules')
      .select('id, account_id')
      .eq('id', id)
      .maybeSingle()

    if (ruleError) return NextResponse.json({ error: ruleError.message }, { status: 500 })
    if (!isOwnedRule(existingRule, accountIds)) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    const { error } = await supabase.from('rules').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
