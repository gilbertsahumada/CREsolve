import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-navy-700 bg-navy-800 text-slate-300",
        outline: "border-navy-600 bg-transparent text-slate-300",
        accent: "border-accent/30 bg-accent/10 text-accent",
        success: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
        warning: "border-amber-500/30 bg-amber-500/10 text-amber-400",
        info: "border-blue-500/30 bg-blue-500/10 text-blue-400",
        // Market-status specific
        open: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
        awaiting: "border-amber-500/30 bg-amber-500/10 text-amber-400",
        resolved: "border-blue-500/30 bg-blue-500/10 text-blue-400",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "span";
    return (
      <Comp ref={ref} className={cn(badgeVariants({ variant, className }))} {...props} />
    );
  }
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
