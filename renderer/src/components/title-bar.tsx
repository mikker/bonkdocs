import { cn } from '@/lib/utils'

interface TitleBarProps extends React.HTMLAttributes<HTMLElement> {
  className?: string
  children?: React.ReactNode
}

export function TitleBar({ className, children, ...props }: TitleBarProps) {
  return (
    <nav
      className={cn(
        'flex items-center [-webkit-app-region:drag] pl-4 pr-3',
        '[&_button]:[-webkit-app-region:none]',
        className
      )}
      {...props}
    >
      {children}
    </nav>
  )
}

interface TitleBarTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  className?: string
}

export function TitleBarTitle({ className, ...props }: TitleBarTitleProps) {
  return <h1 className={cn('text-sm font-semibold', className)} {...props} />
}
