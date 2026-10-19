import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-pill text-sm font-medium tracking-tight ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:cursor-not-allowed',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-pressed active:scale-[0.97] disabled:bg-meta-divider disabled:text-meta-slate/60',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-destructive/90 active:scale-[0.97]',
        outline:
          'border-2 border-meta-charcoal/10 bg-transparent text-meta-charcoal hover:bg-meta-charcoal/5 hover:border-meta-charcoal/20',
        secondary:
          'bg-meta-soft-gray text-meta-charcoal hover:bg-meta-divider active:scale-[0.97]',
        ghost:
          'text-meta-charcoal hover:bg-meta-soft-gray',
        link:
          'rounded-none text-primary underline-offset-4 hover:underline px-0',
      },
      size: {
        default: 'h-10 px-[22px] py-[10px]',
        sm: 'h-9 px-4 text-xs',
        lg: 'h-12 px-7 text-[15px]',
        icon: 'h-10 w-10 rounded-full',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
