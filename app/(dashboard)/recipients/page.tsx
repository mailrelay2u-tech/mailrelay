'use client'
import { useEffect, useState } from 'react'
import { useToast } from '@/lib/hooks/useToast'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Input, Btn, Badge, Card, Skeleton } from '@/components/ui'

interface Recipient { id: string; name: string; email: string; active: boolean }

export default function RecipientsPage() {
  const { toast } = useToast()
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', email: '' })
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  async function load() {
    const res = await fetch('/api/recipients')
    const data = await res.json()
    setRecipients(data.recipients ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addRecipient() {
    if (!form.name || !form.email) { toast('Name and email required', 'error'); return }
    setSaving(true)
    const res = await fetch('/api/recipients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) { toast(data.error || 'Failed to add recipient', 'error'); setSaving(false); return }
    toast('Recipient added', 'success')
    setShowAdd(false); setForm({ name: '', email: '' }); load(); setSaving(false)
  }

  async function toggleActive(id: string, active: boolean) {
    await fetch('/api/recipients', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active: !active }),
    })
    toast(active ? 'Recipient paused' : 'Recipient resumed', 'success')
    load()
  }

  async function deleteRecipient(id: string) {
    await fetch('/api/recipients', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    toast('Recipient deleted', 'success')
    setDeleteId(null); load()
  }

  return (
    <div className="space-y-5 pt-2 md:pt-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Recipients</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{recipients.length} recipient{recipients.length !== 1 ? 's' : ''}</p>
        </div>
        <Btn onClick={() => setShowAdd(true)}>+ Add Recipient</Btn>
      </div>

      {showAdd && (
        <Card className="p-5 space-y-3">
          <h2 className="font-semibold text-gray-800 dark:text-white">Add Recipient</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="Full name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            <Input placeholder="Email address" type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div className="flex gap-2 pt-1">
            <Btn onClick={addRecipient} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Btn>
            <Btn variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Btn>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-16" />)}</div>
      ) : recipients.length === 0 ? (
        <Card className="p-10 text-center">
          <div className="w-14 h-14 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <p className="text-gray-500 dark:text-gray-400 mb-3">No recipients added yet.</p>
          <Btn onClick={() => setShowAdd(true)}>Add your first recipient</Btn>
        </Card>
      ) : (
        <Card className="divide-y divide-gray-100 dark:divide-gray-800">
          {recipients.map(r => (
            <div key={r.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#4B6BF1]/10 dark:bg-[#4B6BF1]/20 flex items-center justify-center shrink-0">
                  <span className="text-sm font-bold text-[#4B6BF1]">{r.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-white">{r.name}</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{r.email}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Badge type={r.active ? 'success' : 'neutral'}>{r.active ? 'Active' : 'Paused'}</Badge>
                <Btn size="sm" variant="ghost" onClick={() => toggleActive(r.id, r.active)}>
                  {r.active ? 'Pause' : 'Resume'}
                </Btn>
                <Btn size="sm" variant="danger" onClick={() => setDeleteId(r.id)}>Delete</Btn>
              </div>
            </div>
          ))}
        </Card>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Recipient?"
          message="They will be removed from all rule assignments."
          confirmLabel="Delete"
          danger
          onConfirm={() => deleteRecipient(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}
