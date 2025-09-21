// src/components/ui/Button.tsx
"use client";

import * as React from "react";
import Link from "next/link";

type Variant = "primary" | "outline";
type Size = "sm" | "md";

export type ButtonProps = {
  /**
   * If provided, renders a Next.js Link with button styling.
   */
  href?: string;
  /**
   * Visual variant.
   */
  variant?: Variant;
  /**
   * Size.
   */
  size?: Size;
  /**
   * Optional icon element placed before the children.
   */
  leadingIcon?: React.ReactNode;
  /**
   * Optional icon element placed after the children.
   */
  trailingIcon?: React.ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement> &
  React.AnchorHTMLAttributes<HTMLAnchorElement>;

function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function baseClasses(disabled?: boolean) {
  return clsx(
    "inline-flex items-center justify-center whitespace-nowrap select-none",
    "rounded-full", // pill shape
    "font-medium",
    "transition-colors",
    "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
    disabled && "opacity-60 cursor-not-allowed"
  );
}

function variantClasses(variant: Variant, disabled?: boolean) {
  switch (variant) {
    case "primary":
      return clsx(
        "bg-gray-900 text-white shadow-sm",
        !disabled && "hover:bg-gray-800",
        "focus-visible:outline-gray-900"
      );
    case "outline":
    default:
      return clsx(
        "border text-gray-700",
        !disabled && "hover:bg-gray-50",
        "focus-visible:outline-gray-300"
      );
  }
}

function sizeClasses(size: Size) {
  switch (size) {
    case "sm":
      return "px-3 py-1 text-xs";
    case "md":
    default:
      return "px-4 py-2 text-sm";
  }
}

export function Button({
  href,
  variant = "outline",
  size = "md",
  className,
  disabled,
  leadingIcon,
  trailingIcon,
  children,
  ...rest
}: ButtonProps) {
  const classes = clsx(
    baseClasses(disabled),
    variantClasses(variant, disabled),
    sizeClasses(size),
    className
  );

  if (href) {
    // Render as Link for navigation
    return (
      <Link href={href} className={classes} aria-disabled={disabled} {...rest}>
        {leadingIcon ? <span className="mr-1.5">{leadingIcon}</span> : null}
        <span>{children}</span>
        {trailingIcon ? <span className="ml-1.5">{trailingIcon}</span> : null}
      </Link>
    );
  }

  // Render as native button
  return (
    <button className={classes} disabled={disabled} {...rest}>
      {leadingIcon ? <span className="mr-1.5">{leadingIcon}</span> : null}
      <span>{children}</span>
      {trailingIcon ? <span className="ml-1.5">{trailingIcon}</span> : null}
    </button>
  );
}

export default Button;
