// src/app/modules/booking/[id]/edit/page.tsx
import Link from "next/link";
import { PrismaClient, AppearanceType } from "@prisma/client";

export const runtime = "nodejs";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = d.getFullYear();
  const mm = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const hh = pad(d.getHours());
  const mi = pad(d.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

export default async function EditBookingPage({
  params,
}: {
  params: { id: string };
}) {
  const booking = await prisma.booking.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      subject: true,
      startAt: true,
      durationMins: true,
      appearanceType: true,
      locationName: true,
      locationUrl: true,
      programName: true,
      hostName: true,
      talkingPoints: true,
    },
  });

  if (!booking) {
    return (
      <main className="mx-auto max-w-2xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Edit Booking</h1>
        <div className="rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Booking not found.
        </div>
        <p>
          <Link href="/modules/booking" className="text-sm underline">
            ← Back to bookings
          </Link>
        </p>
      </main>
    );
  }

  const subject = booking.subject ?? "";
  const durationMins = booking.durationMins ?? 30;
  const startAt = booking.startAt ? new Date(booking.startAt) : new Date();
  const appearanceType = booking.appearanceType ?? AppearanceType.ONLINE;
  const locationName = booking.locationName ?? "";
  const locationUrl = booking.locationUrl ?? "";
  const programName = booking.programName ?? "";
  const hostName = booking.hostName ?? "";
  const talkingPoints = booking.talkingPoints ?? "";

  const patchScript = `
    (function () {
      var form = document.getElementById("edit-booking-form");
      var errorBox = document.getElementById("form-error");
      var submitBtn = document.getElementById("submit-btn");

      if (!form) {
        document.addEventListener("DOMContentLoaded", bind, { once: true });
      } else {
        bind();
      }

      function bind() {
        form = form || document.getElementById("edit-booking-form");
        errorBox = errorBox || document.getElementById("form-error");
        submitBtn = submitBtn || document.getElementById("submit-btn");
        if (!form) return;

        form.addEventListener("submit", function (e) {
          e.preventDefault();
          save();
        });

        if (submitBtn) {
          submitBtn.addEventListener("click", function (e) {
            e.preventDefault();
            save();
          });
        }
      }

      function changedOnly(form) {
        var out = {};
        var el = form.elements;

        function addIfChanged(name, value) {
          var input = form.querySelector("[name='" + name + "']");
          if (!input) return;
          var init = input.getAttribute("data-initial");
          if (init === null) {
            if (value !== "" && value !== null && value !== undefined) out[name] = value;
            return;
          }
          if (String(value ?? "") !== String(init ?? "")) out[name] = value;
        }

        addIfChanged("subject", el.namedItem("subject")?.value ?? "");

        var dt = el.namedItem("startAt")?.value;
        if (dt) addIfChanged("startAt", new Date(dt).toISOString());

        var durRaw = el.namedItem("durationMins")?.value;
        if (durRaw) {
          var dur = parseInt(durRaw, 10);
          if (!Number.isNaN(dur)) addIfChanged("durationMins", dur);
        }

        var ap = form.querySelector("input[name='appearanceType']:checked");
        if (ap) addIfChanged("appearanceType", ap.value);

        addIfChanged("locationName", el.namedItem("locationName")?.value ?? "");
        addIfChanged("locationUrl", el.namedItem("locationUrl")?.value ?? "");

        addIfChanged("programName", el.namedItem("programName")?.value ?? "");
        addIfChanged("hostName", el.namedItem("hostName")?.value ?? "");
        addIfChanged("talkingPoints", el.namedItem("talkingPoints")?.value ?? "");

        return out;
      }

      async function save() {
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "Saving…"; }
        errorBox.textContent = "";
        try {
          var payload = changedOnly(form);
          if (!payload || Object.keys(payload).length === 0) {
            window.location.href = "/modules/booking?updated=1";
            return;
          }
          var id = form.getAttribute("data-id");
          var res = await fetch("/api/bookings/" + id, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          if (!res.ok) {
            var data = null;
            try { data = await res.json(); } catch (_){}
            throw new Error((data && data.error) || "Failed to update booking");
          }
          window.location.href = "/modules/booking?updated=1";
        } catch (err) {
          errorBox.textContent = (err && err.message) || "Failed to update booking";
        } finally {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Save changes"; }
        }
      }
    })();
  `;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Edit Booking</h1>
      <p className="text-sm text-gray-600">
        Update the minimal fields: subject, time, location, and extras.
      </p>

      {/* CHANGED: method="post" + action="#" to prevent the GET-with-query fallback */}
      <form
        id="edit-booking-form"
        data-id={booking.id}
        method="post"
        action="#"
        className="space-y-4"
      >
        <label className="block text-sm font-medium" htmlFor="subject">
          Subject *
        </label>
        <input
          id="subject"
          name="subject"
          defaultValue={subject}
          data-initial={subject}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          required
          maxLength={300}
        />

        <label className="block text-sm font-medium" htmlFor="startAt">
          Start date/time *
        </label>
        <input
          id="startAt"
          name="startAt"
          type="datetime-local"
          defaultValue={toDatetimeLocalValue(startAt)}
          data-initial={toDatetimeLocalValue(startAt)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          required
        />

        <label className="block text-sm font-medium" htmlFor="durationMins">
          Duration (minutes) *
        </label>
        <input
          id="durationMins"
          name="durationMins"
          type="number"
          min={5}
          max={600}
          step={5}
          defaultValue={durationMins}
          data-initial={String(durationMins)}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          required
        />

        <div className="space-y-2">
          <span className="block text-sm font-medium">Appearance Type</span>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="appearanceType"
                value="ONLINE"
                defaultChecked={appearanceType === AppearanceType.ONLINE}
                data-initial={
                  appearanceType === AppearanceType.ONLINE
                    ? "ONLINE"
                    : undefined
                }
              />
              Online
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="appearanceType"
                value="IN_PERSON"
                defaultChecked={appearanceType === AppearanceType.IN_PERSON}
                data-initial={
                  appearanceType === AppearanceType.IN_PERSON
                    ? "IN_PERSON"
                    : undefined
                }
              />
              In-person
            </label>
          </div>
        </div>

        <label className="block text-sm font-medium" htmlFor="locationName">
          Location name
        </label>
        <input
          id="locationName"
          name="locationName"
          defaultValue={locationName}
          data-initial={locationName}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          placeholder="e.g., Studio A"
        />

        <label className="block text-sm font-medium" htmlFor="locationUrl">
          Location URL (map / meeting link)
        </label>
        <input
          id="locationUrl"
          name="locationUrl"
          defaultValue={locationUrl}
          data-initial={locationUrl}
          className="w-full rounded-lg border px-3 py-2 text-sm"
          placeholder="https://…"
        />

        <label className="block text-sm font-medium" htmlFor="programName">
          Program name (optional)
        </label>
        <input
          id="programName"
          name="programName"
          defaultValue={programName}
          data-initial={programName}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <label className="block text-sm font-medium" htmlFor="hostName">
          Host name (optional)
        </label>
        <input
          id="hostName"
          name="hostName"
          defaultValue={hostName}
          data-initial={hostName}
          className="w-full rounded-lg border px-3 py-2 text-sm"
        />

        <label className="block text-sm font-medium" htmlFor="talkingPoints">
          Talking points (optional)
        </label>
        <textarea
          id="talkingPoints"
          name="talkingPoints"
          defaultValue={talkingPoints}
          data-initial={talkingPoints}
          className="h-28 w-full rounded-lg border px-3 py-2 text-sm"
        />

        <div className="mt-2 flex items-center gap-3">
          <button
            id="submit-btn"
            type="submit"
            className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white"
          >
            Save changes
          </button>
          <Link
            href={`/modules/booking/${booking.id}`}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            Cancel
          </Link>
        </div>

        <p id="form-error" className="text-sm text-red-600" role="alert" />
      </form>

      <script
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: patchScript }}
      />
    </main>
  );
}
