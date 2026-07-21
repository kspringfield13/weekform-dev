"use client";

import { useActionState, useRef, useState } from "react";

import { createInvite } from "../actions";
import { INITIAL_INVITE_STATE } from "../inviteState";

/**
 * Owner/manager invite form. The server action returns the one-time invite
 * URL in action state (never in a query string), and this component shows it
 * with a copy control. Email delivery is intentionally absent — no provider
 * is configured — so copy-link is the documented reliable path.
 */
export function InviteForm({ teamId }: { teamId: string }) {
  const [state, formAction, pending] = useActionState(
    createInvite,
    INITIAL_INVITE_STATE,
  );
  const [copied, setCopied] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);

  async function copyLink() {
    if (!state.inviteUrl) {
      return;
    }
    try {
      await navigator.clipboard.writeText(state.inviteUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard API unavailable (e.g. insecure context): select the text
      // so the user can copy manually.
      linkRef.current?.select();
    }
  }

  return (
    <div>
      <form action={formAction}>
        <input type="hidden" name="team_id" value={teamId} />
        <div className="field">
          <label htmlFor="invite-email">Teammate&apos;s email</label>
          <input
            id="invite-email"
            name="email"
            type="email"
            autoComplete="off"
            placeholder="teammate@example.com"
            required
            aria-describedby="invite-email-hint"
            disabled={pending}
          />
          <span className="field-hint" id="invite-email-hint">
            They join as a member. The invite works once, only for this email,
            and expires in 7 days.
          </span>
        </div>
        <button
          type="submit"
          className="button button-primary"
          disabled={pending}
        >
          {pending ? "Creating invite…" : "Create invite link"}
        </button>
      </form>

      {state.status === "error" && state.message ? (
        <div className="form-alert" role="alert" style={{ marginTop: 14 }}>
          {state.message}
        </div>
      ) : null}

      {state.status === "success" && state.inviteUrl ? (
        <div className="invite-link-box">
          <p className="invite-link-title" role="status" aria-live="polite" aria-atomic="true">
            Invite link for <span className="mono">{state.email}</span>
          </p>
          <div className="invite-link-row">
            <input
              ref={linkRef}
              className="invite-link-input mono"
              type="text"
              readOnly
              value={state.inviteUrl}
              aria-label="Invite link"
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              type="button"
              className="button button-secondary"
              onClick={copyLink}
            >
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
          <p className="invite-link-note">
            Copy this link and send it yourself — this prototype has no email
            provider configured, so nothing is emailed automatically. The link
            is shown only this once; only a hash of it is stored.
          </p>
        </div>
      ) : null}
    </div>
  );
}
