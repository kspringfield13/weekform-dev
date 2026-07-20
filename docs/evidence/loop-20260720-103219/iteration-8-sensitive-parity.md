# Iteration 8 — Individual Web Flagged Captures parity

Date: July 20, 2026  
Scope: bounded authenticated Individual `sensitive` / History Flagged route only

## Outcome

The last missing Desktop screen now has a canonical, nonblank Web destination. `?screen=sensitive` resolves to History / Flagged and serializes back to the same Desktop screen name. Like Desktop, the Flagged context tab appears only while that route is active.

Web preserves the Desktop screen hierarchy and footprint while failing honestly at the local-data boundary:

- the header, unavailable score, 60ch introduction, 42 px icon, 148 px empty-state floor, surface tokens, action placement, and narrow reflow follow the Desktop Flagged composition;
- the browser receives no capture count, screenshot, app name, project hint, summary, timestamp, retention flag, local audit event, or destructive action;
- no fetch, Supabase query/RPC, storage, mutation, or Manager Access path was added;
- Back/Forward restores the selected tab and restores focus only when keyboard focus was already in the context strip;
- direct loads do not steal focus, and unknown routes still fail closed to Week Capacity.

## TDD and verification

The independent test lane first recorded a 0/4 RED result for the missing route, rendered target, accessible boundary, and focus/URL behavior. During GREEN review it also rejected a synthetic zero/empty-queue claim; the final view uses an em dash and explicitly labels the local count unavailable.

```text
Focused sensitive/routing/storage tests
PASS — 20/20 (independent critic) and 21/21 (implementation lane)

npm --prefix apps/web run typecheck
PASS — exit 0

npm run verify:wave3
PASS — 173/173 desktop-cloud tests, 451/451 Web tests, Next production build, 12/12 static pages

npm run build
Run separately after the Wave 3 gate; see final iteration report.

git diff --check
PASS — exit 0
```

The first lead `verify:wave3` attempt exposed two preserved theme-contract failures and stopped at 449/451 Web tests. The shared tree was reconciled to the existing dark-default contract without weakening tests. A second attempt passed both test suites but collided with an independent Next build lock. The final uncontended run above exited 0 in full.

## Rendered proof boundary

`agent-browser doctor` passed installation and Chrome discovery, but the launch test could not create its daemon socket under `/Users/rohnspringfield/.agent-browser` in the managed environment. No authenticated screenshot or pixel-diff claim is made. Source-level geometry and build evidence are not substitutes for the still-required matched Desktop/Web screenshots.

## Review

The independent critic approved the bounded repair with no blocking issue. See `iteration-8-sensitive-critic.md` for the route, focus, privacy, Manager separation, accessibility, build, and evidence-integrity review.

Overall mission status remains open for authenticated matched screenshots and human operator approval.
