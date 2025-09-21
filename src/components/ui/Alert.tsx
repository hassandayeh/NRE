// src/components/ui/Alert.tsx

import * as React from "react";

type Variant = "success" | "info" | "error" | "warning";

export type AlertProps = {
  /**
   * Visual variant.
   */
  variant?: Variant;
  /**
   * Optional bold heading (e.g., "Booking updated").
   */
  title?: React.ReactNode;
  /**
   * Optional supporting text.
   */
  children?: React.ReactNode;
  /**
   * Extra classes for spacing/placement.
   */
  className?: string;
  /**
   * ARIA role. Defaults to "status".
   */
  role?: React.AriaRole;
  /**
   * ARIA live region politeness. Defaults to "polite".
   */
  ariaLive?: "off" | "polite" | "assertive";
};

function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const VARIANT_CLASSES: Record<Variant, string> = {
  success: "border-green-200 bg-green-50 text-green-800",
  info: "border-blue-200 bg-blue-50 text-blue-800",
  error: "border-red-200 bg-red-50 text-red-800",
  warning: "border-yellow-200 bg-yellow-50 text-yellow-800",
};

export function Alert({
  variant = "info",
  title,
  children,
  className,
  role = "status",
  ariaLive = "polite",
}: AlertProps) {
  return (
    <div
      role={role}
      aria-live={ariaLive}
      className={clsx(
        "rounded-xl border px-4 py-3 text-sm",
        VARIANT_CLASSES[variant],
        className
      )}
    >
      {title ? <div className="font-medium">{title}</div> : null}
      {children ? <div>{children}</div> : null}
    </div>
  );
}

export default Alert;
