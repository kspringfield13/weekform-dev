# Weekform — three-minute product demo

**Runtime target:** 3:00<br>
**Primary audience:** individual analysts and adjacent knowledge workers<br>
**Data:** synthetic only<br>
**Demo thesis:** Weekform turns a messy, interruption-heavy week into a defensible answer to “Can I take this on next week?”

## Positioning spine

**One-line description**

Weekform is a local-first Mac workload intelligence app that turns reviewed work evidence into a reliable estimate of what can fit next.

**Who it is for**

Individual analysts whose actual weeks are shaped by recurring reporting, ad hoc requests, meetings, dependencies, and fragmented focus—not only the work in their project plan.

**The job to be done**

Before accepting a new project or deadline, understand what consumed the week, what is putting delivery at risk, and how much new planned work the next week can absorb without likely slippage.

**Why it is different**

- Evidence is limited, local-first, source-attributed, and reviewable.
- The user—not an inference or manager—decides what becomes reviewed truth.
- Capacity is computed by a deterministic model; AI can explain or propose but does not silently redefine it.
- Guidance stays approval-gated and is compared with observed outcomes.
- The optional team layer receives only the weekly aggregates a member previews and approves.

**Do not lead with**

- “Productivity tracking,” “employee performance,” or “utilization monitoring.”
- Every data source or integration.
- The team dashboard before the individual decision is understood.
- AI as the product. The product is the workload decision; AI is an optional assistant around it.

## Screen flow

| Time | Screen | On-screen action | Purpose |
| --- | --- | --- | --- |
| 0:00–0:18 | Week → Capacity | Begin on the untouched synthetic week: 24% reliable capacity, 56% committed, 21% reactive. | State the problem and answer before explaining the machinery. |
| 0:18–0:43 | Today | Show “2 blocks need a quick look” and the confirm, relabel, and exclude controls. | Establish that captured activity is candidate evidence, not truth. |
| 0:43–1:08 | Today | Change **Self-service analytics requirements** from **Planned** to **Unplanned**, then confirm it. Point to the sidebar changing from 24% to 17%. | Prove that reviewed truth changes the model immediately. |
| 1:08–1:38 | Week → Capacity | Show the updated 17% capacity, 63% committed, and 30% reactive values. | Make the concrete commitment decision. |
| 1:38–1:58 | Week → Forecast | Point to **Model bias from your corrections** and the scored prior forecast. | Show visible uncertainty and learning against the user's own history. |
| 1:58–2:17 | Agent → Accelerate | Show **Ways to reclaim your week**, the repeating Hex → Looker → Teams workflow, and realized-savings history. | Close the loop from diagnosis to an outcome that can be measured. |
| 2:17–2:50 | Codex + repository evidence | Show one preselected public-safe Codex task view, then `README.md` and `docs/BUILD_WEEK_2026.md`. | Explain the human–Codex build loop and its evidence. |
| 2:50–3:00 | Weekform closing frame | Return to the capacity screen or logo lockup. | Restate the product promise. |

## Spoken script

### 0:00–0:18 — The question

> Analysts do not run out of calendar. They run out of dependable capacity after reactive requests, recurring work, and context switching. Weekform is a local-first Mac app that answers one question: what can I safely say yes to next?

### 0:18–0:43 — Evidence the user controls

> It starts with limited evidence from my calendar, foreground apps, and local imports. These are candidate work blocks—not truth. Ten of twelve are already reviewed. I can confirm the obvious ones, relabel what the model misunderstood, or exclude anything irrelevant or sensitive.

### 0:43–1:08 — Correction changes the answer

> This block was labeled planned, but it was actually an interruption, so I mark it unplanned and confirm it. Watch reliable capacity change from 24% to 17%. The model responded to my correction, not a hidden productivity score. AI can suggest cleanup, but I approve every change.

### 1:08–1:38 — The commitment decision

> Now the week shows 63% already committed, 30% reactive, and only 17% dependable room for new planned work after preserving a delivery buffer. A two-day analysis is roughly 40% of a standard week, so it does not fit. I can reduce the scope, move the date, or protect capacity before I commit. That is Weekform's job.

### 1:38–1:58 — Uncertainty and learning

> The forecast remembers that I repeatedly corrected planned work to unplanned, and it scores the last forecast against what actually happened. Weekform makes that bias and error visible. It builds a personal track record instead of pretending its estimate is a universal benchmark.

### 1:58–2:17 — Close the loop

> Weekform also looks for ways to reclaim the week. Here it found a repeating Hex-to-Looker-to-Teams workflow and tracks whether acted-on plays actually saved time. The point is not more advice; it is a change whose effect I can observe.

### 2:17–2:50 — How Codex accelerated the build

> We built Weekform with the same evidence-first discipline. We set the workload decision, privacy boundaries, and approval rules. Codex on GPT-5.6 mapped the code across React, Rust, persistence, and documentation; implemented focused slices; ran gates; and helped critique the running interface. We reviewed, redirected, and refined. The repository records dated sessions and source evidence, separating the inherited prototype from Build Week work. Codex accelerated the loop; we kept product judgment and final approval.

### 2:50–3:00 — Close

> Weekform turns reviewed evidence into a safer yes or no—not a productivity score. Know what fits before you commit.

## Recording notes

- Use `npm run demo`, then open `http://127.0.0.1:5173/?demo=1&screen=weekly`.
- Reload that URL before each take so the demo starts at 24% capacity with two unreviewed blocks.
- The browser demo does not prove native capture, menu-bar behavior, Keychain storage, macOS permissions, or native AI commands. Do not narrate it as proof of those paths.
- The preloaded forecast and acceleration examples are synthetic. Do not show real calendars, window titles, emails, prompts, API keys, customer names, or local paths.
- Use a public-safe Codex task view prepared before recording. Do not scroll through raw session files or unreviewed tool output.
- Keep the Codex description precise: Codex accelerated research, implementation, review, debugging, and validation; humans set the product constraints, reviewed the running result, and made the final decisions.
- Weekform predates Build Week. Keep the inherited baseline distinct from the dated July 13–21 work recorded in `docs/BUILD_WEEK_2026.md`.
- If the relabel interaction does not visibly change the sidebar, stop and reset the synthetic demo rather than narrating an unobserved result.

## Preflight checklist

1. Run `npm run build` and inspect its exit status.
2. Start `npm run demo` and verify the untouched values: 24% reliable, 56% committed, 21% reactive, and two blocks awaiting review.
3. Rehearse the Planned → Unplanned correction and verify the updated values: 17% reliable, 63% committed, and 30% reactive.
4. Verify the Forecast and Accelerate screens are populated before recording.
5. Pre-open the public-safe Codex evidence and provenance sections so the final switch takes less than three seconds.
6. Enable Do Not Disturb and inspect every visible frame for real or sensitive data.
7. Record one timing-only rehearsal before the final take; target 2:55–3:00 without speeding up the correction or the commitment decision.
