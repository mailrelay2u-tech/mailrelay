'use client'
import { useEffect, useState } from 'react'
import { useToast } from '@/lib/hooks/useToast'
import ConfirmDialog from '@/components/ConfirmDialog'
import { Input, Select, Btn, Badge, Card, Skeleton } from '@/components/ui'

interface Recipient { id: string; name: string; email: string }
interface Account { id: string; label: string; email: string }
interface Rule {
  id: string; name: string; active: boolean
  from_filter: string | null; subject_filter: string | null
  account_id: string; account_email: string | null; account_label: string | null
  recipients: Recipient[]
}

const emptyForm = { name: '', account_id: '', from_filter: '', subject_filter: '', recipient_ids: [] as string[] }

export default function RulesPage() {
  const { toast } = useToast()
  const [rules, setRules] = useState<Rule[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  async function load() {
    const [r, a, rec] = await Promise.all([
      fetch('/api/rules').then(r => r.json()),
      fetch('/api/accounts').then(r => r.json()),
      fetch('/api/recipients').then(r => r.json()),
    ])
    setRules(r.rules ?? [])
    setAccounts(a.accounts ?? [])
    setRecipients(rec.recipients ?? [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function saveRule() {
    if (!form.name) { toast('Rule name is required', 'error'); return }
    if (!form.account_id) { toast('Select an account', 'error'); return }
    if (!form.from_filter && !form.subject_filter) { toast('At least one filter required', 'error'); return }
    setSaving(true)
    const res = await fetch('/api/rules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await res.json()
    if (!res.ok) { toast(data.error || 'Failed to create rule', 'error'); setSaving(false); return }
    toast('Rule created', 'success')
    setShowAdd(false); setForm(emptyForm); load(); setSaving(false)
  }

  async function toggleActive(id: string, active: boolean) {
    await fetch('/api/rules', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, active: !active }),
    })
    toast(active ? 'Rule paused' : 'Rule resumed', 'success')
    load()
  }

  async function deleteRule(id: string) {
    await fetch('/api/rules', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    toast('Rule deleted', 'success')
    setDeleteId(null); load()
  }

  function toggleRecipient(id: string) {
    setForm(f => ({
      ...f,
      recipient_ids: f.recipient_ids.includes(id)
        ? f.recipient_ids.filter(r => r !== id)
        : [...f.recipient_ids, id],
    }))
  }

  return (
    <div className="space-y-5 pt-2 md:pt-0">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Forwarding Rules</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{rules.filter(r => r.active).length} active rule{rules.filter(r => r.active).length !== 1 ? 's' : ''}</p>
        </div>
        <Btn onClick={() => setShowAdd(true)}>+ New Rule</Btn>
      </div>

      {showAdd && (
        <Card className="p-5 space-y-3">
          <h2 className="font-semibold text-gray-800 dark:text-white">Create Rule</h2>
          <Input placeholder="Rule name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <Select value={form.account_id} onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}>
            <option value="">Select account…</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.label} ({a.email})</option>)}
          </Select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input placeholder="From filter (e.g. school@ac.rw)" value={form.from_filter}
              onChange={e => setForm(f => ({ ...f, from_filter: e.target.value }))} />
            <Input placeholder="Subject contains (e.g. result)" value={form.subject_filter}
              onChange={e => setForm(f => ({ ...f, subject_filter: e.target.value }))} />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Recipients <span className="text-gray-400 font-normal">(leave empty to skip)</span>
            </p>
            <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-xl p-3">
              {recipients.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">No recipients yet — add them in the Recipients page first.</p>
              ) : recipients.map(r => (
                <label key={r.id} className="flex items-center gap-2.5 text-sm cursor-pointer group">
                  <input type="checkbox" checked={form.recipient_ids.includes(r.id)} onChange={() => toggleRecipient(r.id)}
                    className="w-4 h-4 rounded accent-[#4B6BF1]" />
                  <span className="text-gray-700 dark:text-gray-300 group-hover:text-gray-900 dark:group-hover:text-white">
                    {r.name} <span className="text-gray-400 dark:text-gray-500">({r.email})</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Btn onClick={saveRule} disabled={saving}>{saving ? 'Saving…' : 'Save Rule'}</Btn>
            <Btn variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Btn>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20" />)}</div>
      ) : rules.length === 0 ? (
        <Card className="p-10 text-center">
          <div className="w-14 h-14 bg-gray-100 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <p className="text-gray-500 dark:text-gray-400 mb-3">No forwarding rules yet.</p>
          <Btn onClick={() => setShowAdd(true)}>Create your first rule</Btn>
        </Card>
      ) : (
        <Card className="divide-y divide-gray-100 dark:divide-gray-800">
          {rules.map(rule => (
            <div key={rule.id} className="p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900 dark:text-white">{rule.name}</p>
                  <Badge type={rule.active ? 'success' : 'neutral'}>{rule.active ? 'Active' : 'Paused'}</Badge>
                </div>

                {/* Account this rule watches */}
                {rule.account_email && (
                  <div className="flex items-center gap-1.5 mt-1.5">
                    <svg className="w-3 h-3 text-gray-400 dark:text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                      {rule.account_label ? `${rule.account_label} (${rule.account_email})` : rule.account_email}
                    </span>
                  </div>
                )}

                {/* Filters */}
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {rule.from_filter && (
                    <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 px-2 py-0.5 rounded-lg font-mono">
                      from: {rule.from_filter}
                    </span>
                  )}
                  {rule.subject_filter && (
                    <span className="text-xs bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400 px-2 py-0.5 rounded-lg font-mono">
                      subject: {rule.subject_filter}
                    </span>
                  )}
                </div>

                {/* Recipients */}
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                  → {rule.recipients.length > 0 ? rule.recipients.map(r => r.email).join(', ') : 'No recipients assigned'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <Btn size="sm" variant="ghost" onClick={() => toggleActive(rule.id, rule.active)}>
                  {rule.active ? 'Pause' : 'Resume'}
                </Btn>
                <Btn size="sm" variant="danger" onClick={() => setDeleteId(rule.id)}>Delete</Btn>
              </div>
            </div>
          ))}
        </Card>
      )}

      {deleteId && (
        <ConfirmDialog
          title="Delete Rule?"
          message="This will remove the rule and all its recipient mappings."
          confirmLabel="Delete Rule"
          danger
          onConfirm={() => deleteRule(deleteId)}
          onCancel={() => setDeleteId(null)}
        />
      )}
    </div>
  )
}
