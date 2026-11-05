import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '../../lib.ts';

const button = cva(
  'inline-flex h-control shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-(--dur-fast) select-none disabled:opacity-50 [&_svg]:size-3.5',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
        outline: 'border border-strong bg-surface-2 text-foreground hover:bg-surface-3',
        ghost: 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        danger: 'border border-strong text-destructive hover:bg-surface-2',
      },
      icon: { true: 'w-control px-0' },
    },
    defaultVariants: { variant: 'outline' },
  },
);

/** The one button. Icon-only buttons must carry `aria-label`. */
export function Button({
  variant,
  icon,
  className,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof button>) {
  return <button type="button" className={cn(button({ variant, icon }), className)} {...props} />;
}
