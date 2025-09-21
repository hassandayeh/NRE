// src/components/theme-toggle.tsx
"use client";

import { useTheme } from "./theme-provider";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const label = theme === "dark" ? "Dark" : "Light";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="rounded-full border px-3 py-1.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-900"
      aria-label="Toggle theme"
      title={`Theme: ${label} (click to switch)`}
    >
      {label} mode
    </button>
  );
}
