# Weekform desktop↔web pairing & notarized distribution — specification and threat model (A5)

**Status: SPECIFICATION ONLY — no implementation exists, and none should be
written until a signing identity and a hosted callback exist.** This document
is roadmap item A5 (`docs/EXPANSION_ROADMAP.md`); per that item's ground rule,
no code may pretend to pair without the live path. Written July 19, 2026.

## 1. Current state (what actually ships today)

- The desktop app signs in with **email/password directly against Supabase
  auth** (`signInWithPassword` in
  `apps/desktop/src/services/cloudClient.ts`, `grant_type=password`), then
  rotates via `grant_type=refresh_token`. Session material persists locally
  (`cloudStore.ts`; the A4 adapter work moves this behind a storage seam with
  a Keychain-capable implementation).
- There is **no deep link, no custom URL scheme, and no browser-initiated
  flow**. The web app (weekform.dev) and desktop app share an account but
  pair only by the user typing the same credentials into both.
- Distribution is **source-build only** — no Developer ID signature, no
  notarization, no updater (see `/download`'s honest fallback copy).

## 2. Goal

Replace in-app password entry with browser-completed pairing: the desktop app
never sees the password, sessions arrive via a one-shot, short-lived,
proof-bound exchange, and the app itself is a signed, notarized artifact so
the OS-level trust chain (Gatekeeper, scheme registration) is meaningful.

## 3. Pairing flow (normative design)

Actors: **D** = desktop app, **B** = user's browser on weekform.dev,
**S** = server (Supabase + one new trusted endpoint pair).

1. **Init (D):** D generates a random `code_verifier` (≥ 43 chars,
   CSPRNG) and derives `code_challenge = BASE64URL(SHA-256(verifier))` —
   PKCE-style (RFC 7636). D calls `POST /pair/init` with the challenge only;
   S stores `{pairing_id, code_challenge, created_at, used:false}` and
   returns `pairing_id` plus a short **user code** (8–9 chars, no vowels, for
   display-and-compare only, never a credential).
2. **Hand-off (D→B):** D opens
   `https://weekform.dev/pair?pairing_id=…` in the default browser. The
   desktop shows the user code; the web page shows the same code and requires
   the signed-in user to confirm the codes match before approving.
3. **Approve (B):** after explicit approval by an authenticated browser
   session, S marks the pairing approved and binds it to that user id. The
   approval page states plainly what is being granted (a desktop session for
   this account) — same consent-first posture as the share preview.
4. **Redeem (D):** D polls (bounded, ≤ 5 min) or receives the callback
   `weekform://pair/complete?pairing_id=…` via its registered scheme, then
   calls `POST /pair/redeem` with `pairing_id` + the **raw `code_verifier`**.
   S verifies `SHA-256(verifier) == code_challenge`, checks `used == false`
   and age ≤ TTL, atomically marks `used = true`, and only then mints a
   session (access + refresh token) for the bound user.
5. **Store (D):** tokens go through the A4 storage adapter (Keychain when
   available); nothing else about the desktop session lifecycle changes.

**Hard limits (normative):** pairing TTL **≤ 5 minutes** from init;
**exactly one** redeem per `pairing_id` (atomic compare-and-set — a second
redeem fails even if the verifier is correct); unapproved or expired pairings
redeem to nothing; the `pairing_id` alone must never be sufficient to mint a
session (the verifier never leaves D until redeem, and redeem is
server-verified against the challenge).

## 4. Threat model

| # | Threat | Vector | Mitigation (from §3) |
|---|---|---|---|
| T1 | Deep-link hijack: another app registers `weekform://` | macOS scheme registration is last-writer-wins for unsigned apps | Callback carries only `pairing_id` (useless without the verifier, which never leaves D). Signed+notarized build makes scheme claims attributable. Poll path works with the scheme entirely absent |
| T2 | Pairing-link phishing: attacker sends victim a `/pair?pairing_id=…` they initiated | Victim approves attacker's desktop onto victim's account | Mandatory user-code display-and-compare on BOTH surfaces plus explicit approval wording naming the action; TTL ≤ 5 min narrows the window. Residual risk documented — this is the flow's weakest edge and the reason approval copy must name the device/grant, never a bare "Continue" |
| T3 | Redeem replay / token interception | Network observer or log capture of the redeem call | One-shot atomic redeem; verifier is single-use and unlogged; TLS assumed; tokens issued only in the redeem response body, never in any URL |
| T4 | Verifier brute-force against a known `pairing_id` | Online guessing at `/pair/redeem` | ≥ 256-bit CSPRNG verifier; per-pairing attempt counter (small N, then the pairing burns); TTL bounds total attempts |
| T5 | Desktop token theft at rest | Local disk read | A4: Keychain-backed adapter when available; tokens already excluded from backups/exports (test-enforced invariant, `dataExport.ts`) |
| T6 | Malicious "Weekform" build capturing approvals | Unsigned look-alike binary | Notarized Developer ID distribution + the `/download` gate; until that exists, this doc and the download page state that only source builds exist — no false trust claims |
| T7 | Server-side pairing-table abuse | Bulk init spam | `pair/init` is unauthenticated by design (D has no session yet) → rate-limit by IP, short TTL, and rows are inert without both approval and verifier |

## 5. Blockers (why this is [env-blocked], and the exit checklist)

Implementation may start only when ALL of the following exist, in order:

1. **Apple Developer ID signing identity + notarization pipeline** (T1/T6
   depend on it; an unsigned scheme handler weakens the design's assumptions).
2. **Hosted `weekform.dev/pair` approval page + `pair/init`/`pair/redeem`
   endpoints** with the atomic one-shot semantics above (needs a live
   deployment — the current repo's web app is env-blocked from live Supabase
   verification, see the runbook §0 rows).
3. **A4 landed** (storage adapter seam), so redeemed tokens have a Keychain
   path on day one.

Until then: no `weekform://` scheme registration, no pairing UI, no partial
implementation — a pairing surface that silently falls back to password entry
would train users to approve look-alikes, which is worse than the status quo.
