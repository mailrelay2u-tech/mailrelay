'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Input, Btn } from '@/components/ui'
import OtpInput from '@/components/OtpInput'
import PageLoader from '@/components/PageLoader'

type Step = 'email' | 'otp' | 'newpass'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [redirecting, setRedirecting] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')

    const supabase = createClient()
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email)

    if (resetError) { setError(resetError.message); setLoading(false); return }
    setLoading(false)
    setStep('otp')
    startCooldown()
  }

  async function handleVerifyOtp(e: React.FormEvent) {
    e.preventDefault()
    if (otp.replace(/\s/g, '').length < 6) { setError('Enter the 6-digit code'); return }
    setLoading(true); setError('')

    const supabase = createClient()
    const { error: verifyError } = await supabase.auth.verifyOtp({
      email,
      token: otp.replace(/\s/g, ''),
      type: 'recovery',
    })

    if (verifyError) { setError(verifyError.message); setLoading(false); return }
    setLoading(false)
    setStep('newpass')
  }

  async function handleSetPassword(e: React.FormEvent) {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true); setError('')

    const supabase = createClient()
    const { error: updateError } = await supabase.auth.updateUser({ password })

    if (updateError) { setError(updateError.message); setLoading(false); return }
    setRedirecting(true)
    router.push('/dashboard')
    router.refresh()
  }

  async function handleResend() {
    if (resendCooldown > 0) return
    const supabase = createClient()
    await supabase.auth.resetPasswordForEmail(email)
    setOtp('')
    startCooldown()
  }

  function startCooldown() {
    setResendCooldown(60)
    const t = setInterval(() => {
      setResendCooldown(c => { if (c <= 1) { clearInterval(t); return 0 } return c - 1 })
    }, 1000)
  }

  if (redirecting) return <PageLoader message="Updating your password…" />

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            Mail<span className="text-[#4B6BF1]">Relay</span>
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
            {step === 'email' && 'Reset your password'}
            {step === 'otp' && 'Check your email'}
            {step === 'newpass' && 'Set new password'}
          </p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8">
          {step === 'email' && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Forgot password?</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                Enter your email and we&apos;ll send a 6-digit reset code.
              </p>
              <form onSubmit={handleSendCode} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Email</label>
                  <Input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="you@example.com" autoComplete="email" />
                </div>

                {error && <ErrorBox message={error} />}

                <Btn type="submit" disabled={loading} className="w-full mt-2">
                  {loading ? 'Sending…' : 'Send Reset Code'}
                </Btn>
              </form>
              <p className="mt-5 text-sm text-center">
                <Link href="/login" className="text-[#4B6BF1] hover:underline font-medium">← Back to sign in</Link>
              </p>
            </>
          )}

          {step === 'otp' && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Enter reset code</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                We sent a 6-digit code to <strong className="text-gray-700 dark:text-gray-300">{email}</strong>. It expires in 5 minutes.
              </p>
              <form onSubmit={handleVerifyOtp} className="space-y-5">
                <OtpInput value={otp} onChange={setOtp} disabled={loading} />

                {error && <ErrorBox message={error} />}

                <Btn type="submit" disabled={loading || otp.replace(/\s/g, '').length < 6} className="w-full">
                  {loading ? 'Verifying…' : 'Verify Code'}
                </Btn>
              </form>
              <p className="mt-4 text-sm text-center text-gray-500 dark:text-gray-400">
                Didn&apos;t receive it?{' '}
                <button onClick={handleResend} disabled={resendCooldown > 0}
                  className="text-[#4B6BF1] hover:underline font-medium disabled:opacity-50 disabled:cursor-not-allowed">
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>
              </p>
              <p className="mt-3 text-sm text-center">
                <button onClick={() => { setStep('email'); setError(''); setOtp('') }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs">
                  ← Change email
                </button>
              </p>
            </>
          )}

          {step === 'newpass' && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">Set new password</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">Choose a strong password for your account.</p>
              <form onSubmit={handleSetPassword} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">New Password</label>
                  <div className="relative">
                    <Input type={showPass ? 'text' : 'password'} required value={password}
                      onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" autoComplete="new-password" />
                    <button type="button" onClick={() => setShowPass(s => !s)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                      {showPass
                        ? <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
                        : <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                      }
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Confirm Password</label>
                  <Input type={showPass ? 'text' : 'password'} required value={confirm}
                    onChange={e => setConfirm(e.target.value)} placeholder="Repeat password" autoComplete="new-password" />
                </div>

                {error && <ErrorBox message={error} />}

                <Btn type="submit" disabled={loading} className="w-full mt-2">
                  {loading ? 'Saving…' : 'Set New Password'}
                </Btn>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2.5">
      <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <p className="text-sm text-red-600 dark:text-red-400">{message}</p>
    </div>
  )
}
