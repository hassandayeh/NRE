// src/app/page.tsx
import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "../lib/auth";

export const runtime = "nodejs";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  const signedIn = !!session?.user;
  const name =
    (session as any)?.user?.name ?? (session as any)?.user?.email ?? "Member";
  const roleLabel = (session as any)?.user?.roleLabel as string | undefined;

  if (!signedIn) {
    // Public landing (logged out)
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <section className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Expert Booker — MVP
          </h1>
          <p className="text-gray-600">
            Lightweight newsroom tooling for booking experts. Sign in to explore
            the MVP, or create a new organization to get started.
          </p>
        </section>

        <div className="flex gap-3">
          <Link
            href="/auth/signin"
            className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50 focus:outline-none focus:ring"
          >
            Sign in
          </Link>
          <Link
            href="/auth/signup"
            className="rounded-md bg-black px-4 py-2 text-sm text-white hover:opacity-90 focus:outline-none focus:ring"
          >
            Create an account
          </Link>
        </div>

        <section className="space-y-2">
          <h2 className="text-lg font-medium">What’s in this MVP</h2>
          <ul className="list-disc pl-5 text-sm text-gray-700">
            <li>Bookings module</li>
            <li>Experts directory</li>
            <li>Settings → Users &amp; Roles (slot-based RBAC)</li>
          </ul>
        </section>
      </div>
    );
  }

  // Member home (logged in)
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold">
          Welcome, {name}
          {roleLabel ? (
            <span className="text-gray-500"> — {roleLabel}</span>
          ) : null}
        </h1>
        <p className="text-gray-600">
          Quick links to common areas. You can always use the top navbar too.
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <HomeCard href="/modules/booking" title="Bookings">
          Create and manage bookings.
        </HomeCard>
        <HomeCard href="/modules/experts" title="Directory">
          Search and manage expert profiles.
        </HomeCard>
        <HomeCard href="/modules/settings" title="Settings">
          Users &amp; Roles, org configuration.
        </HomeCard>
        <HomeCard href="/modules/profile" title="Profile">
          Your personal details.
        </HomeCard>
      </div>
    </div>
  );
}

function HomeCard({
  href,
  title,
  children,
}: {
  href: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="block rounded-xl border p-4 hover:bg-gray-50 focus:outline-none focus:ring"
    >
      <div className="text-lg font-medium">{title}</div>
      <p className="mt-1 text-sm text-gray-600">{children}</p>
    </Link>
  );
}
