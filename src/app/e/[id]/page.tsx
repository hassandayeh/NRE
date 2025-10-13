// src/app/e/[id]/page.tsx
import prisma from "../../../lib/prisma";
import { notFound } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "../../../lib/auth";

export const dynamic = "force-dynamic";

async function fetchGuest(id: string) {
  if (!id || typeof id !== "string") return null;
  return prisma.guestProfile.findUnique({
    where: { id },
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      listedPublic: true,
      // room to expand later, e.g. city/country/tags/bio...
    },
  });
}

type PageProps = { params: { id: string } };

export default async function PublicExpertPage({ params }: PageProps) {
  const gp = await fetchGuest(params.id);

  const session = await getServerSession(authOptions);
  const viewerGuestId = (session as any)?.guestProfileId as string | undefined;
  const isOwner = !!viewerGuestId && viewerGuestId === params.id;

  // Hide non-existent profiles, and hide private ones from non-owners
  if (!gp) notFound();
  if (!gp.listedPublic && !isOwner) notFound();

  const name = gp.displayName?.trim() || "Expert";
  const privatePreview = !gp.listedPublic && isOwner;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-center gap-4">
        {gp.avatarUrl ? (
          // Avatar image if provided
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={gp.avatarUrl}
            alt={`${name} avatar`}
            className="h-16 w-16 rounded-full border border-gray-200 object-cover"
          />
        ) : (
          // Minimal placeholder avatar
          <div
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-lg font-semibold"
          >
            {name
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0])
              .join("")
              .toUpperCase()}
          </div>
        )}

        <div>
          <h1 className="text-2xl font-semibold">{name}</h1>
          <p className="text-sm text-gray-500">
            {privatePreview
              ? "Private preview — not publicly listed"
              : "Public expert profile"}
          </p>
        </div>
      </header>

      {/* Future sections:
          - About/bio
          - Location (city/country)
          - Tags/skills
          - Availability
          - Contact/Invite actions (org-scoped)
      */}
      <section className="rounded-xl border border-gray-200 p-5">
        <p className="text-sm text-gray-600">
          This is a minimal public profile. More fields can be added from the
          guest’s “Profile &amp; Privacy” settings.
        </p>
      </section>
    </div>
  );
}

export async function generateMetadata({ params }: PageProps) {
  const gp = await fetchGuest(params.id);
  if (!gp || !gp.listedPublic) {
    return { title: "Expert profile" };
  }
  const name = gp.displayName?.trim() || "Expert";
  return {
    title: `${name} — Expert`,
    description: `${name}'s public expert profile`,
  };
}
