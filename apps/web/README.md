# weekform.dev (apps/web)

The web surface for Weekform: marketing landing page, Google/GitHub OAuth,
passwordless Magic Link, and email/password auth,
the stable `/app` browser-workspace entry, an authenticated dashboard shell,
and the account-gated Mac download page.

Built with Next.js (App Router, TypeScript strict) and `@supabase/ssr`
(`createServerClient` plus the official `updateSession` session-refresh
pattern, wired through the Next.js 16
`proxy.ts` convention — the successor to `middleware.ts`). This workspace is self-contained: it has its own
`package.json` and lockfile and does not participate in the root build.

## Data and browser-storage boundary

- Raw activity, window titles, sessions, evidence, notes, project/stakeholder
  names, screenshots, and the complete deterministic personal workload model
  stay in the Mac app. The optional private Web replica contains only the
  review-safe allowlist documented in `docs/PRIVACY.md`.
- The website stores two narrow `localStorage` preferences: one user-scoped,
  versioned value recording whether the first-run Web workspace intro was
  completed, and one site-wide `light` or `dark` appearance value. Dark is the
  default until a user explicitly selects and saves Light. These values contain
  no workload, identity details, role, team data, or auth material. The website
  has no `sessionStorage`, IndexedDB, or application-managed persistent browser
  workload cache. Authenticated pages
  and actions call Supabase from the Next.js server under the signed-in user's
  RLS session. One ephemeral browser client subscribes to the signed-in user's
  private Broadcast topic and only calls `router.refresh()`; it does not cache rows.
- Standard Supabase auth cookies keep the account session across requests;
  signing out clears that session. Manager Access uses that same account
  session and adds no portal-specific browser storage or appearance cookie.
- Multi-user records necessarily persist in Supabase: accounts, profiles,
  teams, memberships, invites, manager actions, and the allowlisted aggregate
  workload snapshots members explicitly approve in the Mac app. Shared
  snapshots currently remain until the member uses **Delete my cloud history**;
  there is no automatic expiry.
- `/dashboard` and `/teams/[teamId]` are explicitly request-fresh dynamic
  routes. The dashboard also uses private Supabase Broadcast invalidations.
  While visible and online, a client coordinator asks Next.js for a fresh server
  render every 15 seconds and on bounded online/visibility resume events as a fallback.

## Setup

```bash
cd apps/web
npm install
cp .env.example .env.local   # then fill in your Supabase values
npm run dev                  # http://localhost:3000
```

Environment variables. Account, team, and workload pages use only the
publishable URL/anon key plus the signed-in user's cookie session. Two optional
server-only boundaries use secrets: signed artifact delivery and the Webex
OAuth token broker. Neither secret is bundled into browser or desktop code.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase publishable (anon) key |
| `WEEKFORM_ARTIFACT_BUCKET` | Optional. Private Supabase Storage bucket holding the official packaged Mac artifact |
| `WEEKFORM_ARTIFACT_PATH` | Optional. Object path within that bucket, e.g. `releases/Weekform_0.1.0_universal.dmg` |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional, **secret**. Used only in the server-owned official and beta artifact routes to mint short-lived signed URLs; never sent to the browser |
| `WEEKFORM_ARTIFACT_DEVELOPER_ID_SIGNED` | Release proof. Must be exactly `true` only after Developer ID signature verification succeeds |
| `WEEKFORM_ARTIFACT_NOTARIZED` | Release proof. Must be exactly `true` only after Apple notarization succeeds |
| `WEEKFORM_ARTIFACT_STAPLED` | Release proof. Must be exactly `true` only after stapler validation succeeds |
| `WEEKFORM_ARTIFACT_SHA256` | Lower- or uppercase 64-character SHA-256 for the exact uploaded DMG |
| `WEEKFORM_ARTIFACT_VERIFIED_AT` | Canonical UTC timestamp (`YYYY-MM-DDTHH:mm:ss.sssZ`) for the completed release verification run |
| `WEEKFORM_ARTIFACT_SIGNED_URL_TTL_SECONDS` | Optional. Signed-URL lifetime in seconds; defaults to 300, clamped to 30-3600 |
| `WEEKFORM_BETA_ARTIFACT_BUCKET` | Optional. Private bucket for the temporary Beta Version channel; deliberately separate from the trusted release |
| `WEEKFORM_BETA_ARTIFACT_PATH` | Optional. Content-addressed object path ending in `Weekform_0.1.0_universal_Beta.dmg` |
| `WEEKFORM_BETA_ARTIFACT_DEVELOPER_ID_SIGNED` | Beta proof. Must be exactly `true` only after Developer ID signature verification succeeds; this does not attest notarization |
| `WEEKFORM_BETA_ARTIFACT_SHA256` | SHA-256 for the exact private beta DMG |
| `WEEKFORM_BETA_ARTIFACT_VERIFIED_AT` | Canonical UTC timestamp for the beta upload and checksum verification |
| `WEEKFORM_BETA_ARTIFACT_SIGNED_URL_TTL_SECONDS` | Optional beta signed-URL lifetime; defaults to 300, clamped to 30-3600 |
| `WEBEX_CHAT_CLIENT_ID` | Optional. Must match the public client ID configured in the Mac build |
| `WEBEX_CHAT_CLIENT_SECRET` | Optional, **secret**. Used only in `app/api/oauth/webex/token/route.ts` for Webex token exchange/refresh |
| `WEBEX_CHAT_REDIRECT_URI` | Optional. Exact registered loopback callback, normally `http://127.0.0.1:49323/chat-auth/callback` |
| `WEBEX_CHAT_BROKER_SECURITY_VERIFIED` | Operational attestation. Set to exactly `true` only after deployed rate limiting and credential-safe request/proxy/observability logging are verified; otherwise the broker returns 503 |
| `REQUEST_CONTROL_SERVER_CLAIM` | **Secret**, at least 32 UTF-8 bytes. Vercel-only claim for the distributed request-control RPCs; Postgres stores only its SHA-256 digest |
| `REQUEST_CONTROL_IP_HASH_SECRET` | **Secret**, at least 32 UTF-8 bytes and independent from the server claim. HMAC-key for trusted client-IP subjects; raw IP addresses are never stored |
| `REQUEST_CONTROL_TRUSTED_IP_HEADER` | Must be exactly `x-forwarded-for`; other headers fail closed |
| `REQUEST_CONTROL_TRUSTED_PROXY` | Must be exactly `vercel`, with platform `VERCEL=1`; non-Vercel deployments fail closed until a separately implemented trusted-proxy policy exists |

Request-control deployment is intentionally two-sided. Generate two independent
random values of at least 32 bytes, store them only as sensitive Vercel
variables, then store the lowercase SHA-256 of the server claim—not the claim
itself—in Postgres:

```sql
alter database postgres set app.settings.request_control_server_claim_sha256 = '<64 lowercase hex characters>';
```

Reconnect/restart PostgREST after changing that database setting so new request
workers observe it. If the digest, migration, secrets, trusted header, or Vercel
platform proof is absent, every configured provider/broker path fails closed.

Supabase dashboard configuration expected at runtime:

- Email/password auth enabled.
- Google and GitHub providers enabled for the two social sign-in buttons. Their
  provider applications must return through the Supabase Auth callback URL;
  Weekform then returns through `<site-url>/auth/callback`.
- Auth redirect URL allowlist includes `<site-url>/auth/callback` (email
  confirmation and passwordless callbacks are handled there via
  `token_hash`/`type` or PKCE `code`). Include the local callback
  `http://localhost:3000/auth/callback` for development only.
- Optional `profiles` table (`id uuid primary key references auth.users`,
  `display_name text`) with RLS letting a user select/insert their own row.
  The app reads and bootstraps a profile best-effort and falls back to the
  account email when the table or row is absent.
- Repository migrations applied through `202607200006_distributed_request_controls.sql`.
  Simulator authorization remains a separate, explicit maintainer grant; it is
  not implied by a manager team role.

## Canonical origin and browser security

`https://weekform.dev` is the sole canonical Web origin used by metadata.
Requests arriving on `weekform.com`, `www.weekform.com`, or `www.weekform.dev`
are permanently redirected with their path preserved. The corresponding aliases
must still be attached to the deployment and DNS before the application can
receive and redirect them.

Every canonical response receives a deny-by-default Content Security Policy,
`nosniff`, strict-origin referrer handling, a restricted Permissions Policy, and
frame denial. Production permits same-origin Next.js resources plus the
configured HTTPS Supabase origin and its secure Realtime socket. Development
adds only loopback HTTP/WebSocket origins and the eval allowance required by the
local Next.js toolchain.

## Behavior without configuration

The app **builds and runs with no env vars set** (`npm run build` exits 0
with no Supabase project). At runtime without configuration:

- middleware skips session handling,
- auth forms render disabled with an honest "not configured" notice,
- `/app` is the canonical Individual workspace. `/app`, `/dashboard`,
  `/manager-access`, and `/download` show setup panels instead of user or team
  data,
- `/admin` redirects to `/manager-access` and exposes no separate portal.

Route protection for `/app`, `/manager-access`, `/admin`, `/dashboard`, and `/download`
(redirect to `/login` with a `next` return path) only applies once Supabase is
configured.

## Routes

- `/` — landing page (product story, privacy explanation, prototype disclosure)
- `/login`, `/signup` — Google/GitHub OAuth, passwordless Magic Link, and
  email/password auth (server actions); password sign-in is collapsed by default
- `/auth/callback` — Supabase confirmation/PKCE callback
- `/auth/error` — honest auth failure page
- `/app` — protected, stable public entry for Weekform Web; resolves to the
  authenticated dashboard so marketing, documentation, and future clients do
  not need to couple themselves to the internal dashboard route name
- `/manager-access` — protected and request-fresh; filters the signed-in user's
  active memberships to owner/manager roles, opens a sole managed team directly,
  or offers a team chooser when more than one is available
- `/admin` — compatibility redirect to `/manager-access`; no standalone portal
- `/dashboard` — protected legacy-compatible route; primary navigation, auth callbacks,
  and workspace actions return to `/app`. The role-aware Individual workspace
  includes the shared Individual/Manager switch, private personal replica/review requests,
  profile greeting, the signed-in user's teams and role in each, a create-team
  form (calls the `create_team_with_owner` RPC), and an entry point to `/invite`
- `/teams/[teamId]` — protected; owners/managers see the active roster
  (memberships + profiles), a member-invite form, and sent invites with
  status; plain members see an honest limited view (RLS hides the roster)
- `/invite` — invite acceptance; signed-out users are routed through
  login/signup and return here; signed-in users confirm with an explicit
  button (GET never mutates, so prefetchers can't consume the one-time
  token); RPC failures (wrong email, expired, reused, unknown token,
  already a member) map to clear human messages
- `/download` — protected; one native DMG action, release notes, features,
  first-week tips, privacy-permission expectations, and a standard Mac install
  flow. Enables the download only when the private-bucket artifact and complete
  release-proof env vars are set; otherwise it keeps the action visibly
  unavailable — see "Official Mac
  download" below
- `/download/artifact` — protected server route; re-checks the session,
  then either 307-redirects to a freshly minted signed Supabase Storage URL
  (when the artifact env vars are configured) or returns an honest 503
  explaining the fallback (when they are not)
- `/api/oauth/webex/token` — optional server-to-server OAuth boundary used by
  the native Mac app. It accepts only a fixed-client authorization-code/PKCE or
  refresh request, adds the server-only Webex secret, and returns an allowlisted
  no-store token response. It never receives Chat messages or workload data.

## Webex Chat token broker

Webex requires the registered integration secret during authorization-code and
refresh exchanges, including PKCE flows, so that secret cannot ship in the Mac
app. To enable the connector:

1. Register a Webex Integration with the exact loopback redirect configured in
   `WEBEX_CHAT_REDIRECT_URI` and the read-only room, message, people, and KMS
   scopes.
2. Set the client id, secret, and redirect `WEBEX_CHAT_*` variables on this server. Configure the desktop
   with the same public client id and
   `WEEKFORM_CHAT_OAUTH_BROKER_URL=https://<site-origin>/api`; the Mac appends
   `/oauth/webex/token`.
3. Apply `202607200006_distributed_request_controls.sql`, set two independent
   request-control secrets, and store only the lowercase SHA-256 of
   `REQUEST_CONTROL_SERVER_CLAIM` in the Postgres database setting
   `app.settings.request_control_server_claim_sha256`. The broker then enforces
   a distributed 20-request UTC-daily keyed-IP budget, a 30-second lease, and
   replay-safe idempotency before it contacts Webex. Raw IPs, credentials,
   request bodies, and token responses are never written to its receipts.
4. Verify Vercel overwrites `x-forwarded-for`, and ensure authorization codes,
   refresh tokens, request bodies, and token responses are excluded from
   application, proxy, and observability logs. The broker fails closed outside
   that exact trusted-proxy configuration.
5. After verifying both the implemented limiter and deployment logging controls, set
   `WEBEX_CHAT_BROKER_SECURITY_VERIFIED=true` on the broker and in the native
   release configuration. The broker and native connector otherwise remain
   unavailable even when the client id, secret, redirect, and URL are present.
6. Exercise initial authorization, refresh, disconnect, expiry, denial, and
   rate-limit paths against a non-production Webex account before presenting
   the connector as live-proven.

The route is intentionally independent of a weekform.dev account session: the
native app is bound by the one-time authorization code, state, PKCE verifier,
fixed client id, and fixed redirect. The broker processes credentials/tokens
only; the Mac calls Webex message APIs directly and performs the content-free
projection locally.

## Teams and invitations

- Team creation, membership, and invite acceptance run entirely under the
  signed-in user's cookie session against the RLS policies and SECURITY
  DEFINER RPCs in `supabase/migrations/202607190001_team_cloud_v1.sql`.
  There is no service key and no Supabase Auth Admin usage anywhere.
- Invites are member-role, single-use, tied to one lowercased email, and
  expire after 7 days. The raw token (32 random bytes, base64url) exists
  once, in the invite URL shown to the manager at creation; only its
  SHA-256 hex hash is stored (`team_invites.token_hash`).
- **No email is sent.** No email provider is configured for this deployment,
  so the copyable invite link is the documented reliable path; the UI says
  so explicitly.

## Official Mac download

`/download` is authenticated-session-required: signed-out visitors are
redirected to `/login?next=/download` and returned here after signing in.
The repository and Web deployment contain no public DMG fallback. The official
`/download/artifact` route remains fail-closed until private hosting and every
release proof below are present, then re-checks the signed-in session before
minting a short-lived private Storage URL.

The code retains an isolated **Beta Version** route for authenticated internal
evaluation, but production no longer configures or advertises it: the signed,
unnotarized beta was rejected by Gatekeeper. While the official release remains
pending, `/download` offers the public source ZIP and guided local-build
installer instead. That installer places one copy in Applications and removes
its redundant `target/release/bundle/macos/Weekform.app` build output after a
successful install. Beta configuration can never satisfy or weaken the
official signed/notarized/stapled release gate.

**To publish a trusted private artifact:**

1. Build the universal DMG, sign the app with a Developer ID Application
   identity, submit it to Apple's notarization service, staple the accepted
   ticket, and verify the signature, Gatekeeper assessment, notarization ticket,
   mounted contents, architectures, version, and minimum macOS requirement.
2. Compute the SHA-256 of those exact verified bytes. Create a **private**
   Supabase Storage bucket (for example `weekform-releases`) and upload the same
   DMG at `releases/Weekform_0.1.0_universal.dmg`. Keep public/anon access
   closed; only the server-side service role should read it.
3. Set, in the deployment environment (never commit secrets or fabricated proof):
   - `WEEKFORM_ARTIFACT_BUCKET` — the bucket name from step 2
   - `WEEKFORM_ARTIFACT_PATH` — the object path from step 2
   - `SUPABASE_SERVICE_ROLE_KEY` — from Project Settings -> API -> service
     role (secret); do **not** prefix it `NEXT_PUBLIC_`
   - `WEEKFORM_ARTIFACT_DEVELOPER_ID_SIGNED=true`
   - `WEEKFORM_ARTIFACT_NOTARIZED=true`
   - `WEEKFORM_ARTIFACT_STAPLED=true`
   - `WEEKFORM_ARTIFACT_SHA256` — the checksum from step 2
   - `WEEKFORM_ARTIFACT_VERIFIED_AT` — the verification run's ISO timestamp
   - optionally `WEEKFORM_ARTIFACT_SIGNED_URL_TTL_SECONDS` (default `300`,
     clamped to `30`-`3600`)
4. Redeploy. The single "Download now" action hits
   `/download/artifact`, which re-checks the session server-side
   and 307-redirects to a signed URL minted with
   `storage.from(bucket).createSignedUrl(path, ttl)`. The service-role key is
   read only inside that route handler and is never sent to the browser or
   included in any client bundle.
5. Smoke-test the deployed download, compare its bytes with the recorded
   checksum, and update `RELEASE_INFO` in `apps/web/lib/download.ts` to match.

The Web app validates that proof metadata is complete and well-formed; the
release operator or CI pipeline remains responsible for making those
attestations true and for comparing the uploaded bytes with the checksum.

## Testing status (honest)

- Pure invite helpers (token generation, SHA-256 hashing, email
  normalization, expiry math, URL building/parsing, RPC error mapping) are
  covered by `lib/invites.test.ts` (`node:test`, run from the repo root
  with `npm run test:web`).
- Pure download-config helpers (fail-closed proof parsing, missing/blank-var
  fallback, TTL clamping, release copy, absence of a public DMG, and the
  one-action/no-developer-setup page contract) are covered by
  `lib/download.test.ts`, run the same way.
- The separate beta gate, copy, authentication plan, forced filename, private
  response, and official-release isolation are covered by
  `lib/downloadBeta.test.ts`.
- `npm run test:supabase:rls` executes the local pgTAP suite against the
  local Supabase database. A passing local result does not prove the linked or
  production project has the same migrations, configuration, or policies.
- On July 20, 2026, the production Beta Version path was exercised end to end
  with a synthetic account: authenticated page `200`, `/download/beta` `307`,
  300-second signed URL, private/no-store headers, forced beta filename, public
  object denial, and a `6,838,511`-byte fetch whose SHA-256
  (`2dc0b16f473b73521a3c52280471cfdbb9fe56de3b47138f8ee1f565123d3154`)
  matched the exact local Developer ID-signed beta DMG. The synthetic account
  and temporary auth/download state were deleted after verification.

## Known limitations

- Linked and production RLS behavior remains separately unverified (see
  "Testing status" above).
- The private Beta Version artifact is Developer ID signed but not
  Apple-notarized or stapled. Gatekeeper rejects it, so its production download
  configuration is retired; the source-build fallback remains available.
- Invites are member-role only; manager-role invites, invite revocation UI,
  and role changes are not built yet (revocation is permitted by RLS but has
  no button).
- The official "Download now" action remains unavailable until Developer ID
  signing, Apple notarization, stapling, checksum recording, private hosting,
  and a live downloaded-byte comparison are explicitly proven.
- Sessions are standard Supabase cookie sessions; this is a prototype, not
  audited production auth.

## Commands

```bash
npm run dev        # local dev server
npm run build      # production build (works without env vars)
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
```

From the repository root:

```bash
npm run test:web   # node:test suite for the pure invite helpers (via tsx)
npm run test:supabase:rls # executable local pgTAP authorization gate
npm run verify:web:release # static tests + local RLS + production Web build
npm run web:build  # this workspace's production build
```
