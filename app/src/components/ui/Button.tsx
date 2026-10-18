"use client";

import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/format";

type Variant = "primary" | "outline" | "ghost" | "pill" | "dark" | "danger" | "soft";
type Size = "sm" | "md" | "lg" | "icon";

const VARIANTS: Record<Variant, string> = {
  // Navy filled button ("Sign up free", "Continue").
  primary: "bg-primary text-white hover:bg-primary-hover disabled:opacity-50",
  // Navy outlined button (filter triggers, "Switch to Annual", credit packs).
  outline: "border border-primary text-primary bg-white hover:bg-primary/5 dark:bg-transparent dark:text-sky-200 dark:border-sky-200/60",
  ghost: "text-dark hover:bg-black/5 dark:text-white dark:hover:bg-white/10",
  // Rounded gray pills (prompt suggestions, Follow / Hide).
  pill: "rounded-full border border-gray-300 text-dark hover:bg-gray-100 dark:border-gray-600 dark:text-white dark:hover:bg-gray-700",
  // Black filled segmented option ("Latest").
  dark: "bg-dark text-white hover:bg-dark-3",
  danger: "bg-red-600 text-white hover:bg-red-700",
  soft: "border border-stroke bg-white text-dark hover:bg-gray-50 dark:bg-transparent dark:text-white dark:border-white/15",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
  icon: "h-9 w-9 justify-center",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex items-center gap-2 font-medium transition-colors disabled:cursor-not-allowed",
        variant === "pill" ? "" : "rounded-lg",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
});
