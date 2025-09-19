// Landing page with simple feature-flagged navigation.
// Flags use NEXT_PUBLIC_* so they're safe to read in the browser.
// Any flag set to the string "false" will hide its section; everything else shows.

type Boolish = "true" | "false" | undefined;

const readFlag = (v: Boolish, fallback = true) =>
  v === undefined ? fallback : v !== "false";

const FLAGS = {
  BOOKING: readFlag(process.env.NEXT_PUBLIC_FEATURE_BOOKING as Boolish, true),
  PROFILES: readFlag(process.env.NEXT_PUBLIC_FEATURE_PROFILES as Boolish, true),
  SETTINGS: readFlag(process.env.NEXT_PUBLIC_FEATURE_SETTINGS as Boolish, true),
  APPEAR_IN_PERSON: readFlag(
    process.env.NEXT_PUBLIC_APPEARANCE_IN_PERSON as Boolish,
    true
  ),
  APPEAR_ONLINE: readFlag(
    process.env.NEXT_PUBLIC_APPEARANCE_ONLINE as Boolish,
    true
  ),
};

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Expert Booker MVP</h1>
        <p className="text-sm text-gray-600">
          App Router + TypeScript + Tailwind is live. Use the links below to
          navigate to flagged modules.
        </p>
      </header>

      {/* Flags quick view */}
      <section className="rounded-lg border p-4">
        <h2 className="mb-3 text-lg font-semibold">Feature Flags</h2>
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
          <li className="flex items-center justify-between">
            <span>Booking</span>
            <span
              className={`rounded px-2 py-0.5 ${
                FLAGS.BOOKING
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {FLAGS.BOOKING ? "on" : "off"}
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span>Profiles</span>
            <span
              className={`rounded px-2 py-0.5 ${
                FLAGS.PROFILES
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {FLAGS.PROFILES ? "on" : "off"}
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span>Settings</span>
            <span
              className={`rounded px-2 py-0.5 ${
                FLAGS.SETTINGS
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {FLAGS.SETTINGS ? "on" : "off"}
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span>Appearance: In-person</span>
            <span
              className={`rounded px-2 py-0.5 ${
                FLAGS.APPEAR_IN_PERSON
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {FLAGS.APPEAR_IN_PERSON ? "on" : "off"}
            </span>
          </li>
          <li className="flex items-center justify-between">
            <span>Appearance: Online</span>
            <span
              className={`rounded px-2 py-0.5 ${
                FLAGS.APPEAR_ONLINE
                  ? "bg-green-100 text-green-700"
                  : "bg-gray-100 text-gray-600"
              }`}
            >
              {FLAGS.APPEAR_ONLINE ? "on" : "off"}
            </span>
          </li>
        </ul>
      </section>

      {/* Module links shown only when their flags are on */}
      <nav className="grid gap-3">
        {FLAGS.BOOKING && (
          <a
            href="/modules/booking"
            className="rounded-lg border p-4 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2"
          >
            <h3 className="font-semibold">Booking</h3>
            <p className="text-sm text-gray-600">
              Start scaffolding the booking domain.
            </p>
          </a>
        )}

        {FLAGS.PROFILES && (
          <a
            href="/modules/profiles"
            className="rounded-lg border p-4 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2"
          >
            <h3 className="font-semibold">Profiles</h3>
            <p className="text-sm text-gray-600">
              Manage expert/newsroom profiles.
            </p>
          </a>
        )}

        {FLAGS.SETTINGS && (
          <a
            href="/modules/settings"
            className="rounded-lg border p-4 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2"
          >
            <h3 className="font-semibold">Settings</h3>
            <p className="text-sm text-gray-600">
              Toggle modules and appearance options (env for now).
            </p>
          </a>
        )}
      </nav>

      <footer className="pt-4 text-xs text-gray-500">
        Tip: Set any flag to <code>false</code> in your environment (e.g.
        <code className="ml-1 rounded bg-gray-100 px-1">
          NEXT_PUBLIC_FEATURE_SETTINGS=false
        </code>
        ) and restart the dev server to hide that module.
      </footer>
    </main>
  );
}
