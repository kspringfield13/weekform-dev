# Agent route independent critic

Date: 2026-07-20  
Verdict: **APPROVE — no blocking issue in the bounded Individual Agent/Web Ask slice**

## Scope reviewed

- Desktop Agent contract: `apps/desktop/src/components/agent/AgentScreen.tsx` and its `agent-*` rules in `apps/desktop/src/styles.css`.
- Web Individual Ask implementation: `apps/web/components/PersonalAgentWorkspace.tsx` and `PersonalAgentWorkspace.module.css`.
- Existing authenticated backend boundary: `apps/web/app/api/personal-agent/route.ts` and `apps/web/lib/personalAgent.ts`.
- Route placement and Manager separation: `apps/web/app/dashboard/page.tsx` and the route-parity audit.
- New focused contract: `apps/web/lib/individualAgentInteractionParity.test.ts`.

This verdict approves the newly completed Agent interaction-parity slice. It does not claim that every Desktop/Web route, or rendered pixel parity across the whole mission, is complete.

## Findings

### Desktop-shaped layout and interaction states — pass

The Web route retains the Desktop hierarchy: Agent header and freshness status, workload briefing, two-column starter questions, bounded chat shell, assistant/avatar rows, composer, and honest empty/waiting states. The new work closes the route audit's highest-value safe interaction gaps:

- Clear resets only component state (`turns`, draft, error, retry, and copied state); there is no persistence deletion claim.
- Copy writes only the selected Agent answer and reports failure visibly.
- Failed requests retain the exact submitted question and expose Retry.
- Latest settled non-action answers expose follow-up chips and suppress them while sending.
- Consequential intent now renders a distinct Desktop-shaped `Mac approval required` card with a `/download` handoff. It contains no Web approve, confirm, execute, or mutation control.

The new CSS uses the existing Geist/token vocabulary and mirrors Desktop geometry for the 790px message column, 72% user bubble, 28px avatar, bordered action card, compact controls, and visible focus treatment.

### Backend and privacy boundary — pass

The implementation continues to send only `{ question }` to the existing `/api/personal-agent` endpoint. The endpoint authenticates the current user, reloads that user's latest replica under the existing Supabase/RLS session, rejects browser-supplied workload context, and responds with `Cache-Control: no-store`.

Conversation turns remain capped React component state. The component adds no `localStorage`, `sessionStorage`, Supabase client, raw activity, window-title, note, screenshot, credential, or private-evidence field. The empty-state copy accurately says the typed question plus minimized review-safe catalog may reach the server/provider, and warns against sensitive input.

### Manager Access separation — pass

`PersonalAgentWorkspace` remains mounted only in the Individual workspace's `data-web-view="agent"` route. No Manager component, team briefing configuration, manager action, or manager data path was added. Existing tests also prove that Manager briefing configuration cannot activate Individual Ask processing.

### Accessibility and failure behavior — pass at source level

New controls are native buttons/links with explicit labels; the action handoff is grouped and named; errors use `role="alert"`; sending and empty states are announced; and Clear, Copy, follow-up, Retry, and Mac handoff controls have visible focus styles. Requests outside the primary path fail loudly, and the Mac action boundary explicitly says no action ran.

## Independent verification

```text
node --import tsx --test \
  apps/web/lib/individualAgentInteractionParity.test.ts \
  apps/web/lib/individualAgentToolsCompositionParity.test.ts \
  apps/web/lib/personalAgentParity.test.ts \
  apps/web/lib/personalAgent.test.ts
```

Result: **PASS — 32/32 tests**.

```text
npm --prefix apps/web run typecheck
```

Result: **PASS**.

```text
git diff --check -- \
  apps/web/components/PersonalAgentWorkspace.tsx \
  apps/web/components/PersonalAgentWorkspace.module.css \
  apps/web/lib/individualAgentInteractionParity.test.ts
```

Result: **PASS**.

The critic initially reproduced one RED contract mismatch between the independent test and the Mac action-card markup. The implementer and test owner aligned on a structural `macActionCard` contract without removing or weakening the test; the independent rerun above is the final evidence.

## Proof boundaries and remaining non-blocking work

- Rendered proof is unavailable in this sandbox: `npm --prefix apps/web run dev -- --hostname 127.0.0.1 --port 3100` exited `1` with `listen EPERM`. Therefore this review does **not** claim authenticated runtime-browser or pixel-perfect screenshot parity. See `iteration-2-agent-rendered-qa.md` for the exact remaining capture matrix.
- The shared worktree changed externally during review and temporarily contained unrelated staged changes and merge conflicts outside this slice. Those conflicts were not edited by the critic; the final conflict query returned no unmerged paths, but a whole-repository gate is not attributed to this bounded review.
- Desktop-only streaming/stop, persisted/paged history, timestamps, analysis expansion, and local action execution appropriately remain outside Web Ask's temporary, read-only backend contract. Broader Agent polish and the remaining non-Agent route gaps still require later route-by-route work and human approval.

## Decision

**APPROVE.** The bounded Individual Agent/Web Ask repair materially advances Desktop parity, preserves the existing backend and privacy contract, keeps Manager Access separate, and has no blocking source, test, accessibility, or interaction defect found by this critic. Pixel-parity approval remains contingent on the documented authenticated matched-screenshot pass in an environment that can bind the Web server.
