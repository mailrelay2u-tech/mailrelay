import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from './Sidebar'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('name, role')
    .eq('id', user.id)
    .single()

  const isSuperAdmin = profile?.role === 'superadmin'

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
      <Sidebar
        userName={profile?.name ?? user.email ?? ''}
        userEmail={user.email ?? ''}
        isSuperAdmin={isSuperAdmin}
      />
      <main className="flex-1 overflow-y-auto pt-14 md:pt-0">
        <div className="p-4 md:p-6 max-w-6xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  )
}
