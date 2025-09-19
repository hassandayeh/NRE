export default function BookingPage() {
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Booking</h1>
      <p className="text-gray-600">
        Module scaffold is live. We’ll add routes, components, and types here.
      </p>

      <div className="rounded-lg border p-4">
        <h2 className="font-medium">Next steps</h2>
        <ul className="list-disc pl-5 text-sm text-gray-700 space-y-1 mt-2">
          <li>Appearance types (in-person / online) behind flags.</li>
          <li>Locations and booking flow scaffolding.</li>
          <li>Zod forms for validation.</li>
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
