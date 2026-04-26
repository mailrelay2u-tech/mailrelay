import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'

async function getStats(userId: string) {
  const supabase = await createClient()
  const [accounts, rules, logsToday, logsWeek, logsAll, errors, recent] = await Promise.all([
    supabase.from('gmail_accounts').select('id, active').eq('user_id', userId),
    supabase.from('rules').select('id, active'),
    supabase.from('forwarded_log').select('id', { count: 'exact' })
      .gte('forwarded_at', new Date(new Date().setHours(0,0,0,0)).toISOString()),
    supabase.from('forwarded_log').select('id', { count: 'exact' })
      .gte('forwarded_at', new Date(Date.now() - 7 * 86400000).toISOString()),
    supabase.from('forwarded_log').select('id', { count: 'exact' }),
    supabase.from('gmail_accounts').select('id, email, last_poll_status')
      .eq('user_id', userId).neq('last_poll_status', 'ok').not('last_poll_status', 'is', null),
    supabase.from('forwarded_log').select('subject, from_address, forwarded_at, rule_matched')
      .order('forwarded_at', { ascending: false }).limit(10),
  ])
  return {
    totalAccounts: accounts.data?.length ?? 0,
    activeAccounts: accounts.data?.filter(a => a.active).length ?? 0,
    activeRules: rules.data?.filter(r => r.active).length ?? 0,
    today: logsToday.count ?? 0,
    week: logsWeek.count ?? 0,
    all: logsAll.count ?? 0,
    errors: errors.data ?? [],
    recent: recent.data ?? [],
  }
}

function StatCard({ label, value, sub, color = 'blue' }: { label: string; value: number | string; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-[#4B6BF1]',
    green: 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400',
  }
  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
      <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl mb-3 ${colors[color]}`}>
        <span className="text-lg font-bold">{typeof value === 'number' ? value : '—'}</span>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
    </div>
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const stats = await getStats(user!.id)

  return (
    <div className="space-y-6 pt-2 md:pt-0">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Overview of your forwarding activity</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard label="Active Accounts" value={stats.activeAccounts} sub={`${stats.totalAccounts} total`} color="blue" />
        <StatCard label="Active Rules" value={stats.activeRules} color="purple" />
        <StatCard label="Forwarded Today" value={stats.today} color="green" />
        <StatCard label="This Week" value={stats.week} sub={`${stats.all} all time`} color="amber" />
      </div>

      {stats.errors.length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2 className="text-sm font-semibold text-red-700 dark:text-red-400">Accounts with errors</h2>
          </div>
          <ul className="space-y-1">
            {stats.errors.map((a: { id: string; email: string; last_poll_status: string }) => (
              <li key={a.id} className="flex items-center justify-between text-sm">
                <span className="text-red-600 dark:text-red-400">{a.email}</span>
                <Link href="/accounts" className="text-xs font-mono bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400 px-2 py-0.5 rounded-lg hover:bg-red-200 dark:hover:bg-red-900/60">
                  {a.last_poll_status} →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">Recent Activity</h2>
        {stats.recent.length === 0 ? (
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <p className="text-sm text-gray-400 dark:text-gray-500">No emails forwarded yet.</p>
            <Link href="/accounts" className="text-sm text-[#4B6BF1] hover:underline mt-1 inline-block">Add an account to get started →</Link>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {stats.recent.map((log: { subject: string; from_address: string; forwarded_at: string; rule_matched: string }, i: number) => (
              <li key={i} className="py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 dark:text-gray-200 truncate text-sm">{log.subject || '(no subject)'}</p>
                  <p className="text-gray-400 dark:text-gray-500 text-xs mt-0.5 truncate">{log.from_address} · {log.rule_matched}</p>
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500 shrink-0 whitespace-nowrap">
                  {new Date(log.forwarded_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
