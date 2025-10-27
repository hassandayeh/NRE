// src/components/booking/ModeAccessControl.tsx
"use client";

/**
 * <ModeAccessControl />
 * Reusable block for collecting "Mode & Access" values — identical UX for:
 *  - scope="BOOKING": one block on the booking form
 *  - scope="PARTICIPANT": repeated per participant
 *
 * Behaviors (mirrors New page from commit e3151dd7…):
 *  - Two paths:
 *      * Preset path → Mode (dropdown) → Label (dropdown) → Details (auto or dropdown)
 *      * Custom path → free-text Mode, Label, Details
 *  - Validation polish:
 *      * If custom Mode has text → Label & Details required (inline errors)
 *  - Helper hint:
 *      * When Details is auto-filled (single preset option), show “Auto-filled from preset.”
 *  - Empty states:
 *      * If no presets exist → subtle helper to use custom path
 *
 * Internally stateful, with `initial` prefill. Emits `onChange(state, derived, errors)`.
 */

import * as React from "react";

/* ================== Types (exported for reuse) ================== */
export type ModeDto = { slot: number; active: boolean; label?: string | null };

export type AccessPresetRow = {
  modeSlot: number;
  modeLabel: string | null;
  label: string; // e.g., Teams / Zoom / Street
  details: string; // e.g., https://… / address
};

export type BookingAccessConfig = {
  mode: { slot: number; label?: string | null };
  label: string;
  details: string;
  source: "preset" | "custom";
};

export type ModeLevel = "BOOKING" | "PARTICIPANT";

export type ModeAccessState = {
  // Path
  usePresets: boolean;

  // PRESET path
  selectedModeSlot: number | null;
  selectedModeLabel: string | null;
  labelOptions: string[];
  selectedLabel: string;
  detailsOptions: string[];
  selectedDetails: string;

  // CUSTOM path
  modeText: string;
  customLabel: string;
  customDetails: string;
};

export type ModeAccessErrors = {
  customLabel?: string;
  customDetails?: string;
};

export type ModeAccessDerived = {
  /** true when Details is auto-populated from a single preset option */
  autoFilledDetails: boolean;
  /** valid = no blocking validation errors for the chosen path */
  valid: boolean;
  /** built config ready for API, or undefined if nothing meaningful is set yet */
  accessConfig?: BookingAccessConfig;
};

export type ModeAccessControlProps = {
  scope: ModeLevel; // "BOOKING" | "PARTICIPANT"
  modes: ModeDto[];
  presets: AccessPresetRow[];

  /** Prefill once on mount. */
  initial?: Partial<ModeAccessState>;
  /** Disable inputs (e.g., while submitting / lacking permission). */
  disabled?: boolean;

  /**
   * Fired on every meaningful change.
   * - Use `derived.valid` to enable/disable Create/Save.
   * - Use `derived.accessConfig` in payloads.
   */
  onChange?: (
    state: ModeAccessState,
    derived: ModeAccessDerived,
    errors: ModeAccessErrors
  ) => void;
};

/* ================== Helpers ================== */
const clsx = (...xs: Array<string | false | null | undefined>) =>
  xs.filter(Boolean).join(" ");

function uniqSorted(xs: string[]) {
  return Array.from(new Set(xs)).sort((a, b) => a.localeCompare(b));
}

function labelOptionsFor(presets: AccessPresetRow[], modeSlot: number | null) {
  if (modeSlot == null) return [];
  return uniqSorted(
    presets
      .filter((r) => r.modeSlot === modeSlot)
      .map((r) => r.label)
      .filter(Boolean)
  );
}

function detailOptionsFor(
  presets: AccessPresetRow[],
  modeSlot: number | null,
  label: string | ""
) {
  if (modeSlot == null || !label) return [];
  return uniqSorted(
    presets
      .filter((r) => r.modeSlot === modeSlot && r.label === label)
      .map((r) => r.details)
      .filter(Boolean)
  );
}

/** Build AccessConfig, honoring auto-filled single Details choice when empty. */
function buildAccessFromState(s: ModeAccessState): {
  accessConfig?: BookingAccessConfig;
  autoFilledDetails: boolean;
} {
  if (s.usePresets) {
    if (s.selectedModeSlot == null)
      return { accessConfig: undefined, autoFilledDetails: false };
    if (!s.selectedLabel)
      return { accessConfig: undefined, autoFilledDetails: false };

    const single = s.detailsOptions.length === 1 ? s.detailsOptions[0] : "";
    const chosen = s.selectedDetails || single;
    if (!chosen)
      return {
        accessConfig: undefined,
        autoFilledDetails: !!single && !s.selectedDetails,
      };

    return {
      accessConfig: {
        mode: { slot: s.selectedModeSlot, label: s.selectedModeLabel ?? null },
        label: s.selectedLabel,
        details: chosen,
        source: "preset",
      },
      autoFilledDetails: !!single && chosen === single,
    };
  }

  // Custom path
  const modeLabel = (s.modeText || "").trim();
  const lbl = (s.customLabel || "").trim();
  const det = (s.customDetails || "").trim();

  // If entirely empty → nothing to send
  if (!modeLabel && !lbl && !det)
    return { accessConfig: undefined, autoFilledDetails: false };

  return {
    accessConfig: {
      mode: { slot: -1, label: modeLabel || null },
      label: lbl,
      details: det,
      source: "custom",
    },
    autoFilledDetails: false,
  };
}

function validateState(s: ModeAccessState): {
  valid: boolean;
  errors: ModeAccessErrors;
} {
  const errors: ModeAccessErrors = {};
  let valid = true;

  if (!s.usePresets) {
    const hasMode = (s.modeText || "").trim().length > 0;
    if (hasMode && (s.customLabel || "").trim().length === 0) {
      errors.customLabel = "Required when you type a custom Mode.";
      valid = false;
    }
    if (hasMode && (s.customDetails || "").trim().length === 0) {
      errors.customDetails = "Required when you type a custom Mode.";
      valid = false;
    }
  }

  return { valid, errors };
}

/* ================== Component ================== */
export default function ModeAccessControl(props: ModeAccessControlProps) {
  const { modes, presets, disabled, onChange } = props;
  const hasAnyPresets = (presets?.length ?? 0) > 0;

  // Seed initial state once
  const [state, setState] = React.useState<ModeAccessState>(() => {
    const singleActive =
      modes.filter((m) => m.active).length === 1
        ? modes.find((m) => m.active)!
        : null;

    const init: ModeAccessState = {
      usePresets: hasAnyPresets,
      selectedModeSlot: singleActive ? singleActive.slot : null,
      selectedModeLabel: singleActive ? singleActive.label ?? null : null,
      labelOptions: [],
      selectedLabel: "",
      detailsOptions: [],
      selectedDetails: "",
      modeText: "",
      customLabel: "",
      customDetails: "",
      ...(props.initial ?? {}),
    };

    // Hydrate options if mode is preselected
    if (init.selectedModeSlot != null) {
      init.labelOptions = labelOptionsFor(presets, init.selectedModeSlot);
      if (!init.selectedLabel && init.labelOptions.length === 1) {
        init.selectedLabel = init.labelOptions[0];
      }
      init.detailsOptions = detailOptionsFor(
        presets,
        init.selectedModeSlot,
        init.selectedLabel
      );
      if (!init.selectedDetails && init.detailsOptions.length === 1) {
        init.selectedDetails = init.detailsOptions[0];
      }
    }

    return init;
  });

  // Emit derived info on every state change
  const emit = React.useCallback(
    (s: ModeAccessState) => {
      const { accessConfig, autoFilledDetails } = buildAccessFromState(s);
      const { valid, errors } = validateState(s);
      onChange?.(s, { accessConfig, autoFilledDetails, valid }, errors);
    },
    [onChange]
  );

  React.useEffect(() => {
    emit(state);
  }, [state, emit]);

  /* ----------- Handlers ----------- */
  function handleToggleUsePresets(next: boolean) {
    setState((s) => ({ ...s, usePresets: next }));
  }

  function handleModeChange(slotStr: string) {
    const s = Number(slotStr);
    if (Number.isNaN(s)) {
      setState((st) => ({
        ...st,
        selectedModeSlot: null,
        selectedModeLabel: null,
        labelOptions: [],
        selectedLabel: "",
        detailsOptions: [],
        selectedDetails: "",
      }));
      return;
    }
    const m = modes.find((x) => x.slot === s) || null;
    const labels = labelOptionsFor(presets, s);
    const selectedLabel = labels.length === 1 ? labels[0] : "";
    const details = detailOptionsFor(presets, s, selectedLabel);
    setState((st) => ({
      ...st,
      selectedModeSlot: s,
      selectedModeLabel: m?.label ?? null,
      labelOptions: labels,
      selectedLabel,
      detailsOptions: selectedLabel ? details : [],
      selectedDetails: details.length === 1 ? details[0] : "",
    }));
  }

  function handleLabelChange(label: string) {
    setState((st) => {
      const details = detailOptionsFor(presets, st.selectedModeSlot, label);
      return {
        ...st,
        selectedLabel: label,
        detailsOptions: details,
        selectedDetails: details.length === 1 ? details[0] : "",
      };
    });
  }

  /* ----------- Render ----------- */
  const { errors } = validateState(state);
  const autoFilled =
    state.usePresets &&
    state.detailsOptions.length === 1 &&
    (state.selectedDetails || state.detailsOptions[0]) ===
      state.detailsOptions[0];

  return (
    <div className="space-y-3 rounded-md border p-3">
      {/* Toggle: Use presets */}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={!!state.usePresets}
          onChange={(e) => handleToggleUsePresets(e.target.checked)}
          disabled={disabled || !hasAnyPresets}
        />
        <span>Use access presets</span>
      </label>
      {!hasAnyPresets && (
        <div className="text-xs text-gray-500">
          No presets yet. You can still type a custom Mode, Label, and Details.
        </div>
      )}

      {state.usePresets ? (
        <>
          {/* Mode (dropdown) */}
          <label className="block space-y-1">
            <span className="text-sm">Mode</span>
            <select
              value={state.selectedModeSlot ?? ""}
              onChange={(e) => handleModeChange(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
              disabled={disabled || modes.length === 0}
            >
              <option value="">
                {modes.length ? "Select a mode…" : "No active modes configured"}
              </option>
              {modes.map((m) => (
                <option key={m.slot} value={m.slot}>
                  {m.label ?? `Mode ${m.slot}`}
                </option>
              ))}
            </select>
          </label>

          {/* Label (dropdown) */}
          <label className="block space-y-1">
            <span className="text-sm">Label</span>
            <select
              value={state.selectedLabel}
              onChange={(e) => handleLabelChange(e.target.value)}
              className="w-full rounded-md border px-3 py-2"
              disabled={
                disabled ||
                state.selectedModeSlot == null ||
                state.labelOptions.length === 0
              }
            >
              <option value="">
                {state.selectedModeSlot == null
                  ? "Select mode first"
                  : state.labelOptions.length
                  ? "Select a label…"
                  : "No labels for this mode"}
              </option>
              {state.labelOptions.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>

          {/* Details (dropdown or auto) */}
          <div className="space-y-1">
            <span className="text-sm">Details</span>
            {state.detailsOptions.length <= 1 ? (
              <>
                <input
                  value={state.selectedDetails || state.detailsOptions[0] || ""}
                  readOnly
                  className="w-full cursor-not-allowed rounded-md border bg-gray-50 px-3 py-2"
                />
                {autoFilled && (
                  <div className="text-[11px] text-gray-500">
                    Auto-filled from preset.
                  </div>
                )}
              </>
            ) : (
              <select
                value={state.selectedDetails}
                onChange={(e) =>
                  setState((st) => ({ ...st, selectedDetails: e.target.value }))
                }
                className="w-full rounded-md border px-3 py-2"
                disabled={disabled}
              >
                <option value="">Select details…</option>
                {state.detailsOptions.map((d, i) => (
                  <option key={`${d}-${i}`} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            )}
          </div>
        </>
      ) : (
        <>
          {/* CUSTOM: Mode textbox */}
          <label className="block space-y-1">
            <span className="text-sm">Mode</span>
            <input
              value={state.modeText}
              onChange={(e) =>
                setState((st) => ({ ...st, modeText: e.target.value }))
              }
              className="w-full rounded-md border px-3 py-2"
              placeholder="e.g., Online / In-person / Phone"
              disabled={disabled}
            />
          </label>

          {/* CUSTOM: Label */}
          <label className="block space-y-1">
            <span className="text-sm">Label</span>
            <input
              value={state.customLabel}
              onChange={(e) =>
                setState((st) => ({ ...st, customLabel: e.target.value }))
              }
              className="w-full rounded-md border px-3 py-2"
              placeholder="e.g., Teams / HQ address"
              disabled={disabled}
              aria-describedby={errors.customLabel ? "ma-err-label" : undefined}
            />
          </label>
          {errors.customLabel && (
            <div id="ma-err-label" className="text-xs text-red-700">
              {errors.customLabel}
            </div>
          )}

          {/* CUSTOM: Details */}
          <label className="block space-y-1">
            <span className="text-sm">Details</span>
            <input
              value={state.customDetails}
              onChange={(e) =>
                setState((st) => ({ ...st, customDetails: e.target.value }))
              }
              className="w-full rounded-md border px-3 py-2"
              placeholder="https://… or address / info"
              disabled={disabled}
              aria-describedby={
                errors.customDetails ? "ma-err-details" : undefined
              }
            />
          </label>
          {errors.customDetails && (
            <div id="ma-err-details" className="text-xs text-red-700">
              {errors.customDetails}
            </div>
          )}
        </>
      )}
    </div>
  );
}
