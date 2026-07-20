# weekform.com (apps/web)

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
- The website stores one user-scoped, versioned `localStorage` preference for
  whether the first-run Web workspace intro was completed. It contains no
  workload, identity details, role, team data, or auth material. The website
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
| `SUPABASE_SERVICE_ROLE_KEY` | Optional, **secret**. Used only in `app/download/artifact/route.ts` to mint short-lived signed URLs; never sent to the browser |
| `WEEKFORM_ARTIFACT_SIGNED_URL_TTL_SECONDS` | Optional. Signed-URL lifetime in seconds; defaults to 300, clamped to 30-3600 |
| `WEBEX_CHAT_CLIENT_ID` | Optional. Must match the public client ID configured in the Mac build |
| `WEBEX_CHAT_CLIENT_SECRET` | Optional, **secret**. Used only in `app/api/oauth/webex/token/route.ts` for Webex token exchange/refresh |
| `WEBEX_CHAT_REDIRECT_URI` | Optional. Exact registered loopback callback, normally `http://127.0.0.1:49323/chat-auth/callback` |
| `WEBEX_CHAT_BROKER_SECURITY_VERIFIED` | Operational attestation. Set to exactly `true` only after deployed rate limiting and credential-safe request/proxy/observability logging are verified; otherwise the broker returns 503 |

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
- Repository migrations applied through `202607190007_personal_replica_sync.sql`.
  Simulator authorization remains a separate, explicit maintainer grant; it is
  not implied by a manager team role.

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
  flow. Enables the download when the private-bucket artifact env vars are set;
  otherwise it keeps the action visibly unavailable — see "Official Mac
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
3. Add deployment-level rate limiting for this route and ensure request bodies,
   authorization codes, and token responses are excluded from application,
   proxy, and observability logs.
4. After verifying both controls in the deployed environment, set
   `WEBEX_CHAT_BROKER_SECURITY_VERIFIED=true` on the broker and in the native
   release configuration. The broker and native connector otherwise remain
   unavailable even when the client id, secret, redirect, and URL are present.
5. Exercise initial authorization, refresh, disconnect, expiry, denial, and
   rate-limit paths against a non-production Webex account before presenting
   the connector as live-proven.

The route is intentionally independent of a weekform.com account session: the
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
The gate controls the *official packaged distribution path*, not the source
— the page never claims the public GitHub repository is inaccessible, and
always links or names it.

**Current state of this environment:** a 6.1 MB universal DMG is built at
`apps/desktop/src-tauri/target/universal-apple-darwin/release/bundle/dmg/Weekform_0.1.0_universal.dmg`.
It contains Apple silicon and Intel slices plus the standard Applications
shortcut. The app is ad-hoc signed, not Developer ID signed or Apple-notarized.
The verified DMG is copied into the Web release at a content-addressed static
path. A signed-in visitor gets one active **Download now** action; the
authenticated `/download/artifact` route redirects to that website-hosted DMG
when private Storage is unconfigured. The downloaded file is a normal `.dmg`,
not a ZIP or source archive.

**To move the artifact to a private signed-URL path:**

1. After Developer ID signing and Apple notarization, create a **private**
   Supabase Storage bucket (e.g. `weekform-releases`) and upload the DMG at
   `releases/Weekform_0.1.0_universal.dmg`.
2. Leave the bucket's RLS/policies closed to public/anon access — only the
   service-role key (used server-side) should be able to read it.
3. Set, in the deployment's environment (never committed):
   - `WEEKFORM_ARTIFACT_BUCKET` — the bucket name from step 1
   - `WEEKFORM_ARTIFACT_PATH` — the object path from step 1
   - `SUPABASE_SERVICE_ROLE_KEY` — from Project Settings -> API -> service
     role (secret); do **not** prefix it `NEXT_PUBLIC_`
   - optionally `WEEKFORM_ARTIFACT_SIGNED_URL_TTL_SECONDS` (default `300`,
     clamped to `30`-`3600`)
4. Redeploy. The existing single "Download now" action hits
   `/download/artifact`, which re-checks the session server-side
   and 307-redirects to a signed URL minted with
   `storage.from(bucket).createSignedUrl(path, ttl)`. The service-role key is
   read only inside that route handler and is never sent to the browser or
   included in any client bundle.
5. Update `RELEASE_INFO` in `apps/web/lib/download.ts` (version, generated
   date, artifact filename, release notes, and verification status) to match
   the uploaded build.

## Testing status (honest)

- Pure invite helpers (token generation, SHA-256 hashing, email
  normalization, expiry math, URL building/parsing, RPC error mapping) are
  covered by `lib/invites.test.ts` (`node:test`, run from the repo root
  with `npm run test:web`).
- Pure download-config helpers (artifact env parsing, missing/blank-var
  fallback, TTL clamping, TTL copy formatting, DMG metadata, and the
  one-action/no-developer-setup page contract) are covered by
  `lib/download.test.ts`, run the same way.
- The local DMG has passed `hdiutil verify`; its mounted contents include
  `Weekform.app` and `Applications -> /Applications`; `lipo -archs` reports
  `x86_64 arm64`; its bundle reports version `0.1.0` and minimum macOS `13.0`.
- **Integration and RLS cases have NOT been executed.** No Supabase project
  or local Supabase CLI stack is available on this machine, so team
  creation, invite insert authorization, and `accept_team_invite`
  positive/negative paths were not run against a real database. The
  expected outcomes are documented in
  `docs/hackathon/TEAM_CLAWFATHER_RLS_MATRIX.md` (all cells EXPECTED, not
  VERIFIED). Run the flow against a configured Supabase project before
  claiming it verified.
- **The optional private signed-URL artifact path has NOT been exercised end-to-end.** There
  is no live Supabase project, private bucket, or uploaded artifact on this
  machine, so `/download/artifact`'s configured branch (session check ->
  bucket policy) is real code but has only been verified by
  code inspection. The bundled website artifact path is separately covered by
  a byte-level checksum test and production route verification. Run the private
  path against a configured Supabase project with an uploaded artifact before
  claiming that optional path verified.

## Known limitations

- Integration/RLS behavior is unexecuted (see "Testing status" above).
- The optional private signed-URL artifact path is unexecuted end-to-end (see
  "Testing status" above); production currently uses the bundled Web artifact.
- Invites are member-role only; manager-role invites, invite revocation UI,
  and role changes are not built yet (revocation is permitted by RLS but has
  no button).
- The universal macOS artifact is attached to the website download action but
  is not Developer ID signed or Apple-notarized.
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
npm run web:build  # this workspace's production build
```
