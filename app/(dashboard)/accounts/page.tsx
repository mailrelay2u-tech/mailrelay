'use client'
import { useEffect, useState } from 'react'
import { useToast } from '@/lib/hooks/useToast'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Input, Btn, Badge, Card, Skeleton } from '@/components/ui'

interface Account {
  id: string; label: string; email: string; active: boolean
  last_polled_at: string | null; last_poll_status: string | null
}

function timeAgo(ts: string | null) {
  if (!ts) return 'Never'
  const m = Math.floor((Date.now() - new Date(ts).getTime()) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge type="neutral">Never polled</Badge>
  if (status === 'ok') return <Badge type="success">● Healthy</Badge>
  if (status === 'auth_error') return <Badge type="error">Auth error</Badge>
  return <Badge type="warning">IMAP error</Badge>
}

export default function AccountsPage() {
  const { toast } = useToast()
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ label: '', email: '', app_password: '' })
  const [showPass, setShowPass] = useState(false)
  const [rotateId, setRotateId] = useState<string | null>(null)
  const [rotatePass, setRotatePass] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/accounts')
    if (!res.ok) { toast('Failed to load accounts', 'error'); return }
    const data = await res.json()
    setAccounts(data.accounts ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addAccount() {
    if (!form.label || !form.email || !form.app_password) { toast('All fields required', 'error'); return }
    setSaving(true)
    const res = await fetch('/api/accounts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) { toast(data.error || 'Failed to add account', 'error'); setSaving(false); return }
    toast('Account added', 'success')
    setShowAdd(false); setForm({ label: '', email: '', app_password: '' }); load(); setSaving(false)
  }

  async function toggleActive(id: string, active: boolean) {
    const res = await fetch('/api/accounts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active: !active }),
    })
    if (!res.ok) { toast('Failed to update', 'error'); return }
    toast(active ? 'Account paused' : 'Account resumed', 'success')
    load()
  }

  async function rotatePassword(id: string) {
    if (!rotatePass) { toast('Enter a new app password', 'warning'); return }
    setSaving(true)
    const res = await fetch('/api/accounts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, app_password: rotatePass }),
    })
    if (!res.ok) { toast('Failed to rotate password', 'error'); setSaving(false); return }
    toast('App password updated', 'success')
    setRotateId(null); setRotatePass(''); setSaving(false); load()
  }

  async function deleteAccount(id: string) {
    const res = await fetch('/api/accounts', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    if (!res.ok) { toast('Failed to delete', 'error'); return }
    toast('Account deleted', 'success')
    setDeleteId(null); load()
  }

  return (
    <div className="space-y-5 pt-2 md:pt-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Gmail Accounts</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{accounts.length} account{accounts.length !== 1 ? 's' : ''} connected</p>
        </div>
        <Btn onClick={() => setShowAdd(true)}>+ Add Account</Btn>
      </div>

      {showAdd && (
        <Card className="p-5 space-y-3">
          <h2 className="font-semibold text-gray-800 dark:text-white">Add Gmail Account</h2>
          <Input placeholder="Label (e.g. Work Gmail)" value={form.label}
            onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
          <Input placeholder="Gmail address" type="email" value={form.email}
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          <div className="relative">
            <Input placeholder="App Password" type={showPass ? 'text' : 'password'} value={form.app_password}
              onChange={e => setForm(f => ({ ...f, app_password: e.target.value.replace(/\s/g, '') }))}
              onPaste={e => { e.preventDefault(); const v = e.clipboardData.getData('text').replace(/\s/g, ''); setForm(f => ({ ...f, app_password: v })) }} />
            <button type="button" onClick={() => setShowPass(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={showPass
                  ? "M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
                  : "M15 12a3 3 0 11-6 0 3 3 0 016 0zM2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"} />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Generate an App Password at Google Account → Security → App Passwords
          </p>
          <div className="flex gap-2 pt-1">
            <Btn onClick={addAccount} disabled={saving}>{saving ? 'Saving…' : 'Save Account'}</Btn>
            <Btn variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Btn>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>
      ) : accounts.length === 0 ? (
        <Card className="p-10 text-center">
          <div className="w-14 h-14 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <p className="text-gray-500 dark:text-gray-400 mb-3">No Gmail accounts connected yet.</p>
          <Btn onClick={() => setShowAdd(true)}>Add your first account</Btn>
        </Card>
      ) : (
        <Card className="divide-y divide-gray-100 dark:divide-gray-800">
          {accounts.map(acc => (
            <div key={acc.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900 dark:text-white">{acc.label}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{acc.email}</p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <StatusBadge status={acc.last_poll_status} />
                    <span className="text-xs text-gray-400 dark:text-gray-500">{timeAgo(acc.last_polled_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                  <Btn size="sm" variant={acc.active ? 'secondary' : 'ghost'}
                    onClick={() => toggleActive(acc.id, acc.active)}>
                    {acc.active ? 'Pause' : 'Resume'}
                  </Btn>
                  <Btn size="sm" variant="ghost"
                    onClick={() => setRotateId(rotateId === acc.id ? null : acc.id)}>
                    Rotate Key
                  </Btn>
                  <Btn size="sm" variant="danger" onClick={() => setDeleteId(acc.id)}>Delete</Btn>
                </div>
              </div>

              {rotateId === acc.id && (
                <div className="flex gap-2 pt-1">
                  <Input type="password" placeholder="New app password" value={rotatePass}
                    onChange={e => setRotatePass(e.target.value.replace(/\s/g, ''))}
                    onPaste={e => { e.preventDefault(); setRotatePass(e.clipboardData.getData('text').replace(/\s/g, '')) }}
                    className="flex-1" />
                  <Btn onClick={() => rotatePassword(acc.id)} disabled={saving}>
                    {saving ? '…' : 'Update'}
                  </Btn>
                  <Btn variant="secondary" onClick={() => { setRotateId(null); setRotatePass('') }}>Cancel</Btn>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Account?"
          message="This will also delete all rules and forwarding logs for this account. This cannot be undone."
          confirmLabel="Delete Account"
          danger
          onConfirm={() => deleteAccount(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}
