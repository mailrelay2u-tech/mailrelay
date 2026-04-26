'use client'
import { useEffect, useState } from 'react'
import { useToast } from '@/lib/hooks/useToast'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Btn, Badge, Card, Skeleton } from '@/components/ui'

interface Request { id: string; name: string; email: string; status: string; created_at: string }
interface Code { id: string; email: string; code: string; used: boolean; expires_at: string; created_at: string }

export default function AdminInvitesPage() {
  const { toast } = useToast()
  const [requests, setRequests] = useState<Request[]>([])
  const [codes, setCodes] = useState<Code[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<string | null>(null)
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const [rejectId, setRejectId] = useState<string | null>(null)

  async function load() {
    const [r, c] = await Promise.all([
      fetch('/api/admin/requests').then(r => r.json()),
      fetch('/api/admin/invites').then(r => r.json()),
    ])
    setRequests(r.requests ?? [])
    setCodes(c.codes ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function generateCode(req: Request) {
    setGenerating(req.id)
    const res = await fetch('/api/admin/invites', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: req.email, request_id: req.id, name: req.name }),
    })
    const data = await res.json()
    if (!res.ok) { toast(data.error || 'Failed to generate code', 'error'); setGenerating(null); return }
    toast(`Code sent to ${req.email}`, 'success')
    load(); setGenerating(null)
  }

  async function rejectRequest(id: string) {
    await fetch('/api/admin/requests', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action: 'reject' }),
    })
    toast('Request rejected', 'info')
    setRejectId(null); load()
  }

  async function revokeCode(id: string) {
    await fetch('/api/admin/invites', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    toast('Invite code revoked', 'success')
    setRevokeId(null); load()
  }

  const statusBadge = (s: string) => {
    const map: Record<string, 'warning' | 'success' | 'error'> = {
      pending: 'warning', approved: 'success', rejected: 'error',
    }
    return <Badge type={map[s] ?? 'neutral'}>{s}</Badge>
  }

  const pending = requests.filter(r => r.status === 'pending')

  return (
    <div className="space-y-8 pt-2 md:pt-0">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin — Invites</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          {pending.length} pending request{pending.length !== 1 ? 's' : ''}
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Signup Requests</h2>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-16" />)}</div>
        ) : requests.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-gray-400 dark:text-gray-500">No signup requests yet.</p>
          </Card>
        ) : (
          <Card className="divide-y divide-gray-100 dark:divide-gray-800">
            {requests.map(req => (
              <div key={req.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-gray-900 dark:text-white">{req.name}</p>
                    {statusBadge(req.status)}
                  </div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{req.email}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{new Date(req.created_at).toLocaleString()}</p>
                </div>
                {req.status === 'pending' && (
                  <div className="flex items-center gap-2 shrink-0">
                    <Btn size="sm" onClick={() => generateCode(req)} disabled={generating === req.id}>
                      {generating === req.id ? 'Sending…' : 'Send Invite'}
                    </Btn>
                    <Btn size="sm" variant="danger" onClick={() => setRejectId(req.id)}>Reject</Btn>
                  </div>
                )}
              </div>
            ))}
          </Card>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">Issued Invite Codes</h2>
        {loading ? (
          <div className="space-y-2">{[1,2].map(i => <Skeleton key={i} className="h-16" />)}</div>
        ) : codes.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-gray-400 dark:text-gray-500">No codes issued yet.</p>
          </Card>
        ) : (
          <Card className="divide-y divide-gray-100 dark:divide-gray-800">
            {codes.map(c => (
              <div key={c.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <p className="font-mono font-semibold text-gray-900 dark:text-white tracking-widest">{c.code}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">{c.email}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                    Expires {new Date(c.expires_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge type={c.used ? 'neutral' : 'success'}>{c.used ? 'Used' : 'Active'}</Badge>
                  {!c.used && (
                    <Btn size="sm" variant="danger" onClick={() => setRevokeId(c.id)}>Revoke</Btn>
                  )}
                </div>
              </div>
            ))}
          </Card>
        )}
      </section>

      {rejectId && (
        <ConfirmDialog
          title="Reject Request?"
          message="This will mark the signup request as rejected. The user will not be notified automatically."
          confirmLabel="Reject"
          danger
          onConfirm={() => rejectRequest(rejectId)}
          onCancel={() => setRejectId(null)}
        />
      )}

      {revokeId && (
        <ConfirmDialog
          title="Revoke Invite Code?"
          message="This code will be permanently invalidated and cannot be used to create an account."
          confirmLabel="Revoke"
          danger
          onConfirm={() => revokeCode(revokeId)}
          onCancel={() => setRevokeId(null)}
        />
      )}
    </div>
  )
}
