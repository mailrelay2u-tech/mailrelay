'use client'
import { useRef, KeyboardEvent, ClipboardEvent } from 'react'

export default function OtpInput({ value, onChange, disabled }: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  function handleChange(i: number, v: string) {
    const digit = v.replace(/\D/g, '').slice(-1)
    const arr = value.padEnd(6, ' ').split('')
    arr[i] = digit || ' '
    const next = arr.join('').trimEnd()
    onChange(next)
    if (digit && i < 5) inputs.current[i + 1]?.focus()
  }

  function handleKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      if (value[i] && value[i] !== ' ') {
        const arr = value.padEnd(6, ' ').split('')
        arr[i] = ' '
        onChange(arr.join('').trimEnd())
      } else if (i > 0) {
        inputs.current[i - 1]?.focus()
      }
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    onChange(pasted)
    inputs.current[Math.min(pasted.length, 5)]?.focus()
  }

  return (
    <div className="flex gap-2 justify-center">
      {Array.from({ length: 6 }).map((_, i) => (
        <input
          key={i}
          ref={el => { inputs.current[i] = el }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          disabled={disabled}
          value={value[i] && value[i] !== ' ' ? value[i] : ''}
          onChange={e => handleChange(i, e.target.value)}
          onKeyDown={e => handleKey(i, e)}
          onPaste={handlePaste}
          className="w-11 h-12 text-center text-lg font-bold border border-gray-300 dark:border-gray-600
            rounded-xl bg-white dark:bg-gray-800 text-gray-900 dark:text-white
            focus:outline-none focus:ring-2 focus:ring-[#4B6BF1] focus:border-transparent
            disabled:opacity-50 transition-colors"
        />
      ))}
    </div>
  )
}
