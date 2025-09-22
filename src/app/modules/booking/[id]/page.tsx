// src/app/modules/booking/[id]/page.tsx
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type PageProps = {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

export default function BookingIndexPage({
  params,
  searchParams = {},
}: PageProps) {
  // Preserve any query string when redirecting (e.g., ?from=list)
  const qs = new URLSearchParams();
  for (const [key, val] of Object.entries(searchParams)) {
    if (Array.isArray(val)) val.forEach((v) => qs.append(key, String(v)));
    else if (typeof val !== "undefined") qs.set(key, String(val));
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  redirect(`/modules/booking/${params.id}/edit${suffix}`);
}
