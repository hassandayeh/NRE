// src/components/ui/Toast.tsx
"use client";

import * as React from "react";

type Variant = "success" | "info" | "error" | "warning";

export type ToastProps = {
  /**
   * Controls visibility of the toast.
   */
  open: boolean;
  /**
   * Visual variant (colors).
   */
  variant?: Variant;
  /**
   * Main message text.
   */
  title?: React.ReactNode;
  /**
   * Optional supporting text.
   */
  description?: React.ReactNode;
  /**
   * Auto-dismiss after N milliseconds. Set 0 to disable auto-close.
   * Default: 4000ms
   */
  duration?: number;
  /**
   * Called when the toast is dismissed (via timeout, ESC, or close button).
   */
  onOpenChange?: (open: boolean) => void;
  /**
   * Additional classes (applied to the toast container).
   */
  className?: string;
  /**
   * Position on screen.
   * Only "bottom-right" is implemented now to match current UI.
   */
  position?: "bottom-right";
  /**
   * If multiple toasts might be shown at once, supply a stable id for keys.
   */
  id?: string | number;
};

function clsx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

const VARIANT_CLASSES: Record<Variant, string> = {
  success:
    "border-green-200 bg-green-50 text-green-900 dark:bg-green-950/40 dark:text-green-100",
  info: "border-blue-200 bg-blue-50 text-blue-900 dark:bg-blue-950/40 dark:text-blue-100",
  error:
    "border-red-200 bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100",
  warning:
    "border-yellow-200 bg-yellow-50 text-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-100",
};

/**
 * A single toast. Render one or map an array of <Toast />s in a portal-like corner.
 */
export default function Toast({
  open,
  variant = "success",
  title,
  description,
  duration = 4000,
  onOpenChange,
  className,
  position = "bottom-right",
  id,
}: ToastProps) {
  const [visible, setVisible] = React.useState(open);
  const timeoutRef = React.useRef<number | null>(null);

  // sync external open state
  React.useEffect(() => {
    setVisible(open);
  }, [open, id]);

  // auto-dismiss
  React.useEffect(() => {
    if (!visible) return;
    if (duration && duration > 0) {
      timeoutRef.current = window.setTimeout(() => {
        setVisible(false);
        onOpenChange?.(false);
      }, duration);
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [visible, duration, onOpenChange, id]);

  // close on ESC
  React.useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setVisible(false);
        onOpenChange?.(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, onOpenChange]);

  if (!visible) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className={clsx(
        "pointer-events-none fixed z-50",
        position === "bottom-right" && "bottom-4 right-4"
      )}
    >
      <div
        role="status"
        className={clsx(
          "pointer-events-auto w-[320px] max-w-[calc(100vw-2rem)]",
          "rounded-xl border px-4 py-3 shadow-lg",
          "backdrop-blur [--enter:translate-y-2,opacity-0] [--leave:translate-y-2,opacity-0]",
          "data-[state=open]:animate-in data-[state=open]:fade-in data-[state=open]:slide-in-from-bottom-2",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=closed]:slide-out-to-bottom-2",
          VARIANT_CLASSES[variant],
          className
        )}
        data-state={visible ? "open" : "closed"}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {title ? (
              <div className="truncate text-sm font-medium">{title}</div>
            ) : null}
            {description ? (
              <div className="mt-0.5 truncate text-sm/5 opacity-90">
                {description}
              </div>
            ) : null}
          </div>
          <button
            onClick={() => {
              setVisible(false);
              onOpenChange?.(false);
            }}
            className={clsx(
              "ml-2 inline-flex h-6 w-6 items-center justify-center rounded-full",
              "text-current/70 hover:text-current/100",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
            )}
            aria-label="Dismiss"
            title="Dismiss"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
      </div>
    </div>
  );
}
