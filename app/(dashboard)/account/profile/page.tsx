'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/lib/hooks/useToast'
import { Input, Btn, Card } from '@/components/ui'
import Link from 'next/link'

export default function ProfilePage() {
  const { toast } = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return
      setEmail(user.email ?? '')
      supabase.from('profiles').select('name').eq('id', user.id).single()
        .then(({ data }) => { setName(data?.name ?? ''); setLoading(false) })
    })
  }, [])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { error } = await supabase.from('profiles').update({ name }).eq('id', user.id)
    if (error) { toast(error.message, 'error'); setSaving(false); return }
    toast('Profile updated', 'success'); setSaving(false)
  }

  return (
    <div className="max-w-lg space-y-5 pt-2 md:pt-0">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Profile</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Manage your account details</p>
      </div>

      <Card className="p-6">
        {loading ? (
          <div className="space-y-3">
            <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
            <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Display Name</label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email</label>
              <Input value={email} disabled className="opacity-60 cursor-not-allowed" />
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Email cannot be changed here.</p>
            </div>
            <Btn type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Btn>
          </form>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="font-semibold text-gray-800 dark:text-white mb-1">Security</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Update your password to keep your account secure.</p>
        <Link href="/account/security">
          <Btn variant="secondary">Change Password →</Btn>
        </Link>
      </Card>
    </div>
  )
}
