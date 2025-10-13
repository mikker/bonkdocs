import { cn } from '@/lib/utils'

export function TitleBar({ className, children, ...props }) {
  return (
    <nav
      className={cn(
        'flex items-center [-webkit-app-region:drag] pl-4 pr-3 h-12',
        className
      )}
      {...props}
    >
      <div className='w-18 pb-1 flex items-center'>
        <pear-ctrl></pear-ctrl>
      </div>
      {children}
    </nav>
  )
}

export function TitleBarTitle({ className, ...props }) {
  return <h1 className={cn('text-sm font-semibold', className)} {...props} />
}
