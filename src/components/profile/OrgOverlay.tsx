// src/components/profile/OrgOverlay.tsx

import * as React from "react";
import { getServerSession } from "next-auth";
import { authOptions } from "../../lib/auth";
import { revalidatePath } from "next/cache";
import { listNotes, createNote } from "../../lib/server/profile/notes";

/** Server action — adds a note and revalidates the public page. */
async function postNoteAction(formData: FormData) {
  "use server";

  const session = await getServerSession(authOptions);
  const viewerOrgId =
    (session as any)?.orgId ||
    (session as any)?.user?.orgId ||
    (session as any)?.user?.org?.id ||
    "";
  if (!viewerOrgId) return;

  const orgId = String(formData.get("orgId") || "") || viewerOrgId;
  const guestId = String(formData.get("guestId") || "");
  const body = String(formData.get("note") || "").trim();
  if (!guestId || !body) return;

  const authorUserId =
    (session as any)?.user?.id ||
    (session as any)?.user?.sub ||
    (session as any)?.user?.userId ||
    "";
  const authorName =
    (session as any)?.user?.name ||
    (session as any)?.user?.displayName ||
    (session as any)?.user?.email ||
    null;

  await createNote({ orgId, guestId, authorUserId, authorName, body });

  revalidatePath(`/modules/profile/public/${guestId}`, "page");
}

/** Internal Notes (org-only). Renders via footerSlot below the profile. */
export default async function OrgOverlay(props: {
  orgId: string;
  guestId: string;
}) {
  // Only org viewers may see/post notes
  const session = await getServerSession(authOptions);
  const viewerOrgId =
    (session as any)?.orgId ||
    (session as any)?.user?.orgId ||
    (session as any)?.user?.org?.id ||
    "";
  if (!viewerOrgId) return null;

  const effectiveOrgId = props.orgId || viewerOrgId;

  // Load existing notes from DB (newest first)
  const notes = await listNotes(effectiveOrgId, props.guestId);

  return (
    <section aria-labelledby="internal-notes-title" className="mt-8">
      <h2
        id="internal-notes-title"
        className="text-sm font-medium text-gray-900"
      >
        Internal notes (org-only)
      </h2>

      {/* Post form */}
      <form action={postNoteAction} className="mt-2 space-y-2">
        <input type="hidden" name="orgId" value={effectiveOrgId} />
        <input type="hidden" name="guestId" value={props.guestId} />
        <textarea
          name="note"
          rows={3}
          required
          placeholder="Write a note for your producers…"
          className="w-full rounded-md border px-3 py-2 text-sm"
        />
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="rounded-md border bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-900"
          >
            Post
          </button>
        </div>
      </form>

      {/* Notes list */}
      <div className="mt-4 space-y-3">
        {notes.length === 0 ? (
          <div className="text-sm text-gray-500">No notes yet.</div>
        ) : (
          notes.map((n) => (
            <article key={n.id} className="rounded-md border bg-white p-3">
              <div className="whitespace-pre-wrap text-sm text-gray-900">
                {n.body}
              </div>
              <div className="mt-2 text-xs text-gray-500">
                by{" "}
                <span className="font-medium">{n.authorName ?? "Staff"}</span>{" "}
                <span aria-hidden>·</span>{" "}
                <time dateTime={n.createdAt}>
                  {new Date(n.createdAt).toLocaleString()}
                </time>
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
