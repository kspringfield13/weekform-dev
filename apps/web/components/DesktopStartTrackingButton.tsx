"use client";

import type { ReactNode } from "react";
import { useActionState } from "react";

import { queueDesktopStartTracking } from "@/app/dashboard/personalActions";
import { INITIAL_DESKTOP_START_TRACKING_STATE } from "@/lib/desktopActions";

export function DesktopStartTrackingButton({ children }: { children: ReactNode }) {
  const [state, formAction, pending] = useActionState(
    queueDesktopStartTracking,
    INITIAL_DESKTOP_START_TRACKING_STATE,
  );

  return (
    <form action={formAction} className="web-start-tracking-form">
      <button
        className="button button-primary web-start-tracking-action"
        disabled={pending}
        title="Resume tracking in a connected Weekform Desktop app"
        type="submit"
      >
        {pending ? "Contacting Desktop…" : children}
      </button>
      {state.message ? (
        <span
          className={`web-start-tracking-status is-${state.status}`}
          role="status"
        >
          {state.message}
        </span>
      ) : null}
    </form>
  );
}
