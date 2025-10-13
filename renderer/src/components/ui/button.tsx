import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex gap-x-2 items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&>svg]:stroke-1 [&>svg]:text-muted-foreground',
  {
    variants: {
      variant: {
        default:
          'font-medium disabled:opacity-75 dark:disabled:opacity-75 disabled:cursor-default bg-background hover:bg-neutral-50 dark:bg-neutral-700 dark:hover:bg-neutral-600/75 text-neutral-800 dark:text-white border border-neutral-200 hover:border-neutral-200 border-b-neutral-300/80 dark:border-neutral-600 dark:hover:border-neutral-600 shadow-xs',
        secondary:
          'bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80',
        outline:
          'border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground',
        destructive:
          'bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90',
        primary:
          'bg-gradient-to-b from-brand-pear to-[color-mix(in_lab,var(--color-brand-pear),black_25%)] text-neutral-900 border border-brand-pear',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        muted: 'bg-muted text-muted-foreground hover:bg-muted/80',
        link: 'text-primary underline-offset-4 hover:underline',
        'room-panel': 'bg-background border',
        'room-panel-active':
          'bg-gradient-to-b from-brand-pear to-[color-mix(in_lab,var(--color-brand-pear),black_25%)] text-neutral-900 border border-brand-pear'
      },
      size: {
        default: 'h-10 px-4 py-2',
        xs: 'h-6 rounded px-2 py-0.5 text-xs',
        sm: 'h-8 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10'
      }
    },
    defaultVariants: {
      variant: 'default',
      size: 'default'
    }
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant, size, asChild = false, type = 'button', ...props },
    ref
  ) {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp
        ref={ref}
        type={type}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    )
  }
)
