import * as React from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "success" | "warning" | "destructive" | "outline";
}

function Badge({ className, variant = "default", ...props }: BadgeProps) {
  const variants = {
    default: "bg-primary/20 text-primary border-primary/30 neon-text-blue",
    success: "bg-success/20 text-success border-success/30 neon-text-green",
    warning: "bg-warning/20 text-warning border-warning/30 neon-text-yellow",
    destructive: "bg-destructive/20 text-destructive border-destructive/30 neon-text-red",
    outline: "border-border text-muted-foreground",
  };

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-sm border px-2 py-0.5 text-xs font-mono font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
