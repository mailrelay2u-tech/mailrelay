'use client'
import { useState } from 'react'
import Link from 'next/link'
import { Input, Btn } from '@/components/ui'

export default function SignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    const res = await fetch('/api/admin/requests', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email }),
    })
    const data = await res.json()
    if (!res.ok) { setError(data.error || 'Failed to submit request'); setLoading(false); return }
    setSuccess(true); setLoading(false)
  }

  if (success) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
        <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">Request submitted!</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          The admin will review your request and email you an invite code within 48 hours.
        </p>
        <Link href="/login" className="text-sm text-[#4B6BF1] hover:underline font-medium">← Back to login</Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Mail<span className="text-[#4B6BF1]">Relay</span>
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">Request access to get started</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-6">Request Access</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Full Name</label>
              <Input type="text" required value={name} onChange={e => setName(e.target.value)} placeholder="Your name" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email</label>
              <Input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>

            {error && (
              <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5">
                <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              </div>
            )}

            <Btn type="submit" disabled={loading} className="w-full mt-2">
              {loading ? 'Submitting…' : 'Request Access'}
            </Btn>
          </form>

          <p className="mt-5 text-sm text-gray-500 dark:text-gray-400 text-center">
            Already have a code?{' '}
            <Link href="/signup/redeem" className="text-[#4B6BF1] hover:underline font-medium">Redeem invite</Link>
          </p>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 text-center">
            <Link href="/login" className="text-[#4B6BF1] hover:underline font-medium">← Back to login</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
