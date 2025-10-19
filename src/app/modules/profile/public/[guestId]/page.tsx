// src/app/modules/profile/public/[guestId]/page.tsx

import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";

import GuestProfileRenderer from "../../../../../components/profile/GuestProfileRenderer";
import OrgOverlay from "../../../../../components/profile/OrgOverlay";
import { getGuestPublic } from "../../../../../lib/server/profile/getGuestPublic";
import { authOptions } from "../../../../../lib/auth";

export const runtime = "nodejs";
// Cache lightly so public loads fast but stays fresh after edits.
export const revalidate = 300; // 5 minutes

type PageProps = {
  params: { guestId: string };
  searchParams?: Record<string, string | string[] | undefined>;
};

export default async function PublicGuestProfilePage({
  params,
  searchParams,
}: PageProps) {
  const guestId = params.guestId;

  const res = await getGuestPublic(guestId);
  if (!res.ok) return notFound();

  // Prefer orgId from query (?orgId=...), fallback to session org.
  const qOrgRaw = searchParams?.orgId;
  const qOrgId =
    typeof qOrgRaw === "string"
      ? qOrgRaw
      : Array.isArray(qOrgRaw)
      ? qOrgRaw[0]
      : "";

  const session = await getServerSession(authOptions);
  const sessionOrgId =
    (session as any)?.orgId ||
    (session as any)?.user?.orgId ||
    (session as any)?.user?.org?.id ||
    "";

  const orgId = qOrgId || sessionOrgId || "";

  return (
    <GuestProfileRenderer
      profile={res.profile}
      // Show internal notes below the profile content.
      footerSlot={<OrgOverlay orgId={orgId} guestId={guestId} />}
    />
  );
}

/**
 * Clean share cards for public profiles.
 * Uses displayName/headline; never leaks private fields.
 */
export async function generateMetadata({
  params,
}: {
  params: { guestId: string };
}) {
  const guestId = params.guestId;

  const res = await getGuestPublic(guestId);
  if (!res.ok) return {};

  const name = (res.profile as any)?.displayName || "Expert";
  const headline = (res.profile as any)?.headline || "";
  const description =
    (res.profile as any)?.shortBio || headline || "Public expert profile";

  const title = headline ? `${name} — ${headline}` : name;

  const urlPath = `/modules/profile/public/${guestId}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "profile",
      url: urlPath,
    },
    twitter: {
      card: "summary",
      title,
      description,
    },
  };
}
