import type { Metadata } from "next";
import "../styles/globals.css";

export const metadata: Metadata = {
  title: "NRE",
  description: "Expert Booker MVP",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh bg-white text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
