'use client'

export default function PageLoader({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-[150] bg-gray-50 dark:bg-gray-950 flex flex-col items-center justify-center gap-4">
      <div className="relative">
        <div className="w-12 h-12 rounded-full border-4 border-gray-200 dark:border-gray-700" />
        <div className="absolute inset-0 w-12 h-12 rounded-full border-4 border-transparent border-t-[#4B6BF1] animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-gray-600 dark:text-gray-400">{message}</p>
        <p className="text-xs text-gray-400 dark:text-gray-600 mt-1">
          Mail<span className="text-[#4B6BF1]">Relay</span>
        </p>
      </div>
    </div>
  )
}
