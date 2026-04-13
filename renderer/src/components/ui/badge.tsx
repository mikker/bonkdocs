import { cn } from '@/lib/utils'

type BadgeProps = React.HTMLAttributes<HTMLDivElement> & {
  variant?: 'default' | 'outline' | 'destructive'
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide',
        variant === 'default' && 'border border-border text-muted-foreground',
        variant === 'outline' && 'border border-border/60 text-foreground',
        variant === 'destructive' && 'border border-destructive/20 bg-destructive/10 text-destructive',
        className
      )}
      {...props}
    />
  )
}
