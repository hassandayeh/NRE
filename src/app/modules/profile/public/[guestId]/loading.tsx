// src/app/modules/profile/public/[guestId]/loading.tsx

export default function LoadingPublicGuest() {
  return (
    <div className="mx-auto max-w-5xl p-6 animate-pulse">
      {/* Header */}
      <div className="mb-6">
        <div className="h-6 w-40 rounded bg-gray-200" />
        <div className="mt-2 h-4 w-56 rounded bg-gray-100" />
      </div>

      {/* Identity row */}
      <div className="mb-6 flex items-start gap-4">
        <div className="h-16 w-16 shrink-0 rounded-full bg-gray-200" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-48 rounded bg-gray-200" />
          <div className="h-4 w-80 rounded bg-gray-100" />
          <div className="flex gap-2">
            <div className="h-5 w-20 rounded bg-gray-100" />
            <div className="h-5 w-24 rounded bg-gray-100" />
            <div className="h-5 w-16 rounded bg-gray-100" />
          </div>
        </div>
        {/* Overlay slot area hint (keeps layout stable) */}
        <div className="h-20 w-60 rounded bg-gray-100" />
      </div>

      {/* Sections */}
      <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
        {/* Languages & Regions */}
        <div>
          <div className="mb-2 h-4 w-40 rounded bg-gray-200" />
          <div className="h-5 w-24 rounded bg-gray-100" />
        </div>
        {/* Topics & Formats */}
        <div>
          <div className="mb-2 h-4 w-40 rounded bg-gray-200" />
          <div className="flex gap-2">
            <div className="h-5 w-16 rounded bg-gray-100" />
            <div className="h-5 w-14 rounded bg-gray-100" />
            <div className="h-5 w-20 rounded bg-gray-100" />
          </div>
        </div>
        {/* Bio */}
        <div className="md:col-span-2">
          <div className="mb-2 h-4 w-24 rounded bg-gray-200" />
          <div className="space-y-2">
            <div className="h-4 w-full rounded bg-gray-100" />
            <div className="h-4 w-11/12 rounded bg-gray-100" />
            <div className="h-4 w-10/12 rounded bg-gray-100" />
          </div>
        </div>
        {/* Experience */}
        <div>
          <div className="mb-2 h-4 w-28 rounded bg-gray-200" />
          <div className="h-5 w-1/2 rounded bg-gray-100" />
        </div>
        {/* Education */}
        <div>
          <div className="mb-2 h-4 w-40 rounded bg-gray-200" />
          <div className="h-5 w-2/3 rounded bg-gray-100" />
        </div>
        {/* Publications & media */}
        <div className="md:col-span-2">
          <div className="mb-2 h-4 w-48 rounded bg-gray-200" />
          <div className="flex gap-2">
            <div className="h-5 w-24 rounded bg-gray-100" />
            <div className="h-5 w-28 rounded bg-gray-100" />
          </div>
        </div>
      </div>
    </div>
  );
}
