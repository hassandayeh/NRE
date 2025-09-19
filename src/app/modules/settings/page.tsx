export default function SettingsPage() {
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="text-gray-600">
        Env-flagged settings surface. Later we’ll move these to DB-backed org
        settings.
      </p>

      <div className="rounded-lg border p-4">
        <h2 className="font-medium">Today</h2>
        <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1 mt-2">
          <li>
            Feature flags live in <code>.env*</code> (client-safe{" "}
            <code>NEXT_PUBLIC_*</code> only).
          </li>
          <li>Landing page reads flags at build time to show/hide modules.</li>
        </ul>
      </div>

      <div className="rounded-lg border p-4">
        <h2 className="font-medium">Later</h2>
        <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1 mt-2">
          <li>Org admin can toggle modules in-app (DB stored).</li>
          <li>Appearance options (in-person / online) per org.</li>
          <li>Audit log for changes.</li>
        </ul>
      </div>

      <a
        href="/"
        className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2"
      >
        ← Back to home
      </a>
    </main>
  );
}
