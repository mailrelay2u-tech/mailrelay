export function Input({ className = '', ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm
        bg-white dark:bg-gray-800 text-gray-900 dark:text-white
        placeholder:text-gray-400 dark:placeholder:text-gray-500
        focus:outline-none focus:ring-2 focus:ring-[#4B6BF1] focus:border-transparent
        disabled:opacity-50 disabled:cursor-not-allowed transition-colors ${className}`}
    />
  )
}

export function Select({ className = '', children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2.5 text-sm
        bg-white dark:bg-gray-800 text-gray-900 dark:text-white
        focus:outline-none focus:ring-2 focus:ring-[#4B6BF1] focus:border-transparent
        disabled:opacity-50 transition-colors ${className}`}
    >
      {children}
    </select>
  )
}

export function Btn({
  variant = 'primary', size = 'md', className = '', children, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
}) {
  const base = 'inline-flex items-center justify-center font-semibold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2.5 text-sm' }
  const variants = {
    primary: 'bg-[#4B6BF1] hover:bg-[#3a5ae0] text-white',
    secondary: 'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
    danger: 'bg-red-500 hover:bg-red-600 text-white',
    ghost: 'text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800',
  }
  return (
    <button {...props} className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}>
      {children}
    </button>
  )
}

export function Badge({ type, children }: { type: 'success' | 'error' | 'warning' | 'neutral'; children: React.ReactNode }) {
  const styles = {
    success: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400',
    error: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400',
    warning: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400',
    neutral: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400',
  }
  return <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${styles[type]}`}>{children}</span>
}

export function Card({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl ${className}`}>
      {children}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 dark:bg-gray-700 rounded-xl ${className}`} />
}
