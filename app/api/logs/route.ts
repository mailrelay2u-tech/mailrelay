import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const page = Math.max(1, Number(searchParams.get('page') || 1))
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const accountId = searchParams.get('account_id')
  const pageSize = 50

  const service = await createServiceClient()

  // Get user's account IDs
  const { data: accounts } = await service
    .from('gmail_accounts')
    .select('id')
    .eq('user_id', user.id)

  const accountIds = (accounts ?? []).map((a: { id: string }) => a.id)
  if (!accountIds.length) return NextResponse.json({ logs: [], total: 0 })
  if (accountId && !accountIds.includes(accountId)) {
    return NextResponse.json({ logs: [], total: 0 })
  }

  let query = service
    .from('forwarded_log')
    .select('*', { count: 'exact' })
    .in('account_id', accountId ? [accountId] : accountIds)
    .order('forwarded_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1)

  if (from) query = query.gte('forwarded_at', from)
  if (to) query = query.lte('forwarded_at', to + 'T23:59:59')

  const { data, count, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ logs: data, total: count ?? 0 })
}
