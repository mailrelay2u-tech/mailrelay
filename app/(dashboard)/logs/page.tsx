'use client'
import { useEffect, useState } from 'react'
import { useToast } from '@/lib/hooks/useToast'
import { Btn, Card, Skeleton } from '@/components/ui'

interface LogEntry {
  id: string; subject: string; from_address: string
  forwarded_to: string[]; rule_matched: string; forwarded_at: string
}

export default function LogsPage() {
  const { toast } = useToast()
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  async function load(p = 1) {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p) })
    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const res = await fetch(`/api/logs?${params}`)
    if (!res.ok) { toast('Failed to load logs', 'error'); setLoading(false); return }
    const data = await res.json()
    setLogs(data.logs ?? [])
    setTotal(data.total ?? 0)
    setPage(p)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function exportCSV() {
    const rows = [['Subject', 'From', 'Forwarded To', 'Rule', 'Time']]
    logs.forEach(l => rows.push([l.subject, l.from_address, l.forwarded_to?.join(';'), l.rule_matched, l.forwarded_at]))
    const csv = rows.map(r => r.map(c => `"${c ?? ''}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = 'mailrelay-logs.csv'
    a.click()
    toast('CSV exported', 'success')
  }

  const totalPages = Math.ceil(total / 50)

  return (
    <div className="space-y-5 pt-2 md:pt-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Forwarding Logs</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{total} total entries</p>
        </div>
        <Btn variant="secondary" onClick={exportCSV}>Export CSV</Btn>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From date</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4B6BF1]" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To date</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)}
              className="border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#4B6BF1]" />
          </div>
          <Btn onClick={() => load(1)}>Filter</Btn>
          <Btn variant="ghost" onClick={() => { setFrom(''); setTo(''); setTimeout(() => load(1), 0) }}>Clear</Btn>
        </div>
      </Card>

      {loading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-14" />)}</div>
      ) : logs.length === 0 ? (
        <Card className="p-10 text-center">
          <div className="w-14 h-14 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          </div>
          <p className="text-gray-500 dark:text-gray-400">No forwarding logs found.</p>
        </Card>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="md:hidden space-y-3">
            {logs.map(log => (
              <Card key={log.id} className="p-4 space-y-2">
                <p className="font-medium text-gray-900 dark:text-white text-sm">{log.subject || '(no subject)'}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">From: {log.from_address}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">To: {log.forwarded_to?.join(', ')}</p>
                <div className="flex items-center justify-between">
                  <span className="text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded-lg">{log.rule_matched}</span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">{new Date(log.forwarded_at).toLocaleString()}</span>
                </div>
              </Card>
            ))}
          </div>

          {/* Desktop: table */}
          <Card className="hidden md:block overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  {['Subject', 'From', 'Forwarded To', 'Rule', 'Time'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {logs.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white max-w-xs truncate">{log.subject || '(no subject)'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-xs truncate">{log.from_address}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-xs truncate">{log.forwarded_to?.join(', ')}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{log.rule_matched}</td>
                    <td className="px-4 py-3 text-gray-400 dark:text-gray-500 whitespace-nowrap">{new Date(log.forwarded_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
              <span>{total} entries</span>
              <div className="flex items-center gap-2">
                <Btn variant="secondary" size="sm" onClick={() => load(page - 1)} disabled={page === 1}>← Prev</Btn>
                <span className="px-2">Page {page} of {totalPages}</span>
                <Btn variant="secondary" size="sm" onClick={() => load(page + 1)} disabled={page === totalPages}>Next →</Btn>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
