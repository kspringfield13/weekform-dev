# Iteration 6 — Individual Web Accelerate parity

Date: 2026-07-20  
Loop: `loop-20260720-103219-8d922a`  
Scope: Agent → Accelerate (`?screen=accelerate`)

## Outcome and bounded scope

The Individual Web Accelerate route now follows the Desktop Acceleration screen's decision hierarchy and geometry for the states that the review-safe Web contract can truthfully represent:

- a waiting state with the Desktop no-plays header and empty-state composition;
- a loud load-error state with `role="alert"`, retry guidance, and no partial or fabricated acceleration result;
- a connected boundary with Desktop-shaped header, unavailable weekly total, synthesis slot, realized-savings slot, responsive play grid, evidence disclosure, and action region;
- Desktop screen width and padding, header rhythm, Geist Mono eyebrow, heading scale, empty-state geometry, 280 px minimum card grid, 760 px narrow reflow, and visible link/disclosure focus;
- acquisition-only Mac handoffs in place of inert or falsely executable Web controls.

The slice does not add Web acceleration mining, AI generation, recipes, local evidence, outcome tracking, or play mutations. It does not claim parity for Desktop's real populated or all-dismissed data states because the Web replica cannot represent them.

## Team roles

- `accelerate_audit`: independently compared Desktop and Web source, styles, route wiring, state boundaries, and existing tests; supplied the bounded acceptance matrix.
- `accelerate_impl`: implemented the Accelerate component/CSS repair and the focused regression contract.
- `render_probe_critic`: assigned independent runtime/render probing and critic review; rendered proof remains a separate acceptance surface.
- Root Builder: coordinated scope, integrated findings, and ran the standing repository gates.

## RED, review failure, and GREEN

The focused contract first reproduced the source gaps between the existing Web boundary card and the Desktop Acceleration screen: missing distinct waiting/error/connected layouts, divergent header and empty-state geometry, an inert generation control, a constrained single-card footprint, and incomplete disclosure focus treatment.

The first repair also exposed a CTA-truth failure: a `/download` link used action language that implied `Generate Skills`, although selecting it could only acquire the Mac app. The truth contract correctly rejected that mismatch. The repair moved generation wording into explanatory copy (`Generate Skills on Mac`) and labels every `/download` control by its real consequence: `Get Weekform for Mac`. Review and generation remain instructions, not fake Web actions.

Final focused command:

```text
node --test \
  apps/web/lib/individualAccelerationStateParity.test.ts \
  apps/web/lib/individualAgentToolsCompositionParity.test.ts \
  apps/web/lib/downloadCtaTruth.test.ts
```

Final result: PASS, `10/10` tests.

## Standing gates

```text
npm --prefix apps/web run typecheck
```

PASS.

```text
npm run verify:wave3
```

PASS:

- Desktop-cloud tests: `173/173`
- Web tests: `434/434`
- Web production build: successful

```text
npm run build
```

PASS: authoritative TypeScript/bundle gate, including the pricing catalog check and Vite production build.

```text
git diff --check
```

PASS.

## Privacy and backend boundary

No backend route, API request, Supabase query, personal replica schema, persistence path, browser cache, Manager Access surface, or native workflow changed. `PersonalWorkloadReplicaV1` remains a positive allowlist of review-safe blocks and derived capacity. It has no representable acceleration signal, raw window title, workflow evidence, recipe, prompt, AI credential, dismissal, acted-on marker, saved skill, or realized-savings history.

Accordingly, Web renders unavailable markers (`—`, `Confidence unavailable`, and local-only explanations) rather than placeholder savings, confidence, recipes, or outcome rows. Save, acted-on, dismiss, and Generate Skills controls remain Mac-owned and are not simulated in the browser.

## Rendered-proof boundary

Authenticated matched Desktop/Web screenshots remain environment-blocked. The managed environment cannot bind the local Next.js listener, so browser automation cannot reach the authenticated route. The canonical blocker log is:

`docs/evidence/loop-20260720-103219/rendered/qa-report.md`

That report records `listen EPERM` before the first render. This iteration therefore provides source, focused-test, full-suite, typecheck, and build evidence only. It does not claim pixel proof, computed-layout verification, clean runtime console proof, or authenticated operational screenshot parity.

The independent Iteration 6 critic approved this bounded repair with no blocking issue. The overall route-parity mission remains open for Skills and other documented route gaps, authenticated matched screenshots, and human operator approval.
