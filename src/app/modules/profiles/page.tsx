export default function ProfilesPage() {
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Profiles</h1>
      <p className="text-gray-600">
        Module scaffold is live. This will manage expert/newsroom profiles.
      </p>

      <div className="rounded-lg border p-4">
        <h2 className="font-medium">Next steps</h2>
        <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1 mt-2">
          <li>Define profile types (expert, newsroom, producer roles).</li>
          <li>Public vs. private fields; verification status.</li>
          <li>Later: DB schema with Prisma + seed data.</li>
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
