import type { Metadata } from 'next'
import { Sora, DM_Sans } from 'next/font/google'
import { ToastProvider } from '@/lib/hooks/useToast'
import TopProgressBar from '@/components/TopProgressBar'
import './globals.css'

const sora = Sora({ subsets: ['latin'], variable: '--font-sora' })
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans' })

export const metadata: Metadata = {
  title: 'MailRelay — Forward smarter. Manage everything.',
  description: 'Multi-account Gmail forwarding platform',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sora.variable} ${dmSans.variable} h-full`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            const t = localStorage.getItem('theme')
            if (t === 'dark' || (!t && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
              document.documentElement.classList.add('dark')
            }
          } catch {}
        `}} />
      </head>
      <body className="h-full bg-gray-50 dark:bg-gray-950 font-body antialiased">
        <ToastProvider>
          <TopProgressBar />
          {children}
        </ToastProvider>
      </body>
    </html>
  )
}
