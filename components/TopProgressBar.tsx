'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'

export default function TopProgressBar() {
  const pathname = usePathname()
  const [progress, setProgress] = useState(0)
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const prev = useRef(pathname)

  useEffect(() => {
    if (prev.current === pathname) return
    prev.current = pathname

    // Start progress
    setVisible(true)
    setProgress(10)
    timer.current = setInterval(() => {
      setProgress(p => {
        if (p >= 85) { clearInterval(timer.current!); return 85 }
        return p + Math.random() * 12
      })
    }, 120)

    // Complete after short delay
    const done = setTimeout(() => {
      clearInterval(timer.current!)
      setProgress(100)
      setTimeout(() => { setVisible(false); setProgress(0) }, 300)
    }, 400)

    return () => { clearInterval(timer.current!); clearTimeout(done) }
  }, [pathname])

  if (!visible) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[200] h-0.5 pointer-events-none">
      <div
        className="h-full bg-[#4B6BF1] transition-all duration-150 ease-out shadow-[0_0_8px_#4B6BF1]"
        style={{ width: `${progress}%` }}
      />
    </div>
  )
}
