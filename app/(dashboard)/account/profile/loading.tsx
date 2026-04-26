import { Skeleton } from '@/components/ui'
export default function Loading() {
  return (
    <div className="max-w-lg space-y-5 pt-2 md:pt-0">
      <div className="space-y-2"><Skeleton className="h-7 w-32" /><Skeleton className="h-4 w-48" /></div>
      <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 space-y-4">
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-9 w-28 rounded-xl" />
      </div>
    </div>
  )
}
