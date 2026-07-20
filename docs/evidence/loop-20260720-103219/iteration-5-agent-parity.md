# Iteration 5 — Individual Web Ask parity

Date: 2026-07-20  
Loop: `loop-20260720-103219-8d922a`  
Scope: Agent → Ask (`?screen=agent`)

## Outcome

The operational Individual Web Ask route now follows the Desktop Agent's ready, sending, conversation, failure, and Mac-handoff footprints while preserving the existing authenticated Web API and review-safe replica boundary.

The bounded slice adds:

- the Desktop briefing's `Explain forecast` and `Plan my week` shortcuts through the existing `ask` request path;
- Desktop empty-chat collapse, starter hover/focus treatment, 790 px conversation geometry, compact metadata, and follow-up spacing;
- Enter to send, Shift+Enter for a newline, and Command/Ctrl+Enter to send;
- the Desktop composer focus-within treatment;
- an honest 570 px non-streaming progress card grounded only in the published review-safe summary;
- a standalone Desktop-shaped Mac-handoff action card with one Agent mark, a 38 px offset, and a 30 px `/download` pill;
- retained clear, copy, retry, follow-up, error-alert, temporary-conversation, and privacy disclosure behavior.

No API route, Supabase query, replica contract, browser persistence, local evidence, Manager Access, or action-execution wiring changed. The browser request remains exactly `{ question }`; consequential requests still return `Mac approval required · no action run` and cannot execute on Web.

## TDD and critic evidence

Focused RED reproduced two missing contracts: Desktop briefing shortcuts and collapsed empty-chat geometry (`35/37` passing). The first critic pass then rejected a double-icon Mac-handoff composition that source assertions had not caught. The card was moved out of the normal assistant row and its handoff control was restyled to match the Desktop action footprint.

Final focused result: PASS, `19/19` lead-run checks. The independent critic ran the broader focused selection and reported PASS, `39/39`, followed by `APPROVE` with no blocking issue.

## Standing gates

```text
npm run verify:wave3
```

PASS:

- Desktop-cloud suite: successful
- Web tests: `430/430`
- Web production build: successful
- Static pages generated: `12/12`

```text
npm run build
```

PASS: TypeScript build, pricing catalog check (`18` models / `4` official sources), and Vite production build.

```text
npm --prefix apps/web run typecheck
git diff --check
```

PASS.

## Rendered-proof boundary

Authenticated matched Desktop/Web screenshots remain environment-blocked. The Next.js development server failed before browser launch with:

```text
listen EPERM: operation not permitted 0.0.0.0:3141
```

This is not reported as screenshot or pixel proof. The overall route-parity mission remains open for remaining routes, matched authenticated screenshots, and human operator approval.
