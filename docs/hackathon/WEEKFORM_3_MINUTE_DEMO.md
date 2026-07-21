# Weekform — three-minute product demo

**Runtime target:** 3:00<br>
**Primary audience:** Hackathon judges<br>
**Data:** synthetic only<br>
**Format:** screen recording with spoken voiceover (judges must hear a clear audio narration covering what we built and how we used Codex on GPT-5.6)<br>
**Demo thesis:** Weekform turns a messy, interruption-heavy week into a defensible answer to “Can I take this on next week?”

## Positioning spine

**One-line description**

Weekform is a local-first Mac workload intelligence app that turns reviewed work evidence into a reliable estimate of what can fit next.

**Spoken tagline**

Your calendar is an optimist. Weekform is the friend who checks the math.

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

**Tone**

- Dry, confident, lightly funny. Deadpan delivery — the jokes work because the numbers behind them are real.
- Humor targets calendars, meetings, and tools. Never users, never the judges, and never the privacy stance.
- Name the tools judges already know (Jira, Outlook, Asana, Teams) as contrast, not as trash talk. One clause each, then move on.

**Do not lead with**

- “Productivity tracking,” “employee performance,” or “utilization monitoring.”
- Every data source or integration.
- The team dashboard before the individual decision is understood.
- AI as the product. The product is the workload decision; AI is an optional assistant around it.

## Screen flow

| Time | Screen | On-screen action | Purpose |
| --- | --- | --- | --- |
| 0:00–0:18 | Week → Capacity | Begin on the untouched synthetic week: 24% reliable capacity, 56% committed, 21% reactive. | Hook with the familiar lie (the plan) versus the answer on screen. |
| 0:18–0:43 | Today | Show “2 blocks need a quick look” and the confirm, relabel, and exclude controls. | Establish that captured activity is candidate evidence, not truth — and that the user is the editor. |
| 0:43–1:08 | Today | Change **Self-service analytics requirements** from **Planned** to **Unplanned**, then confirm it. Point to the sidebar changing from 24% to 17%. | The magic trick: reviewed truth changes the model live, on camera. |
| 1:08–1:38 | Week → Capacity | Show the updated 17% capacity, 63% committed, and 30% reactive values. | The dramatic beat: a “no with receipts” to a real ask. |
| 1:38–1:58 | Week → Forecast | Point to **Model bias from your corrections** and the scored prior forecast. | The tool that remembers being wrong — visible uncertainty and learning. |
| 1:58–2:17 | Agent → Accelerate | Show **Ways to reclaim your week**, the repeating Hex → Looker → Teams workflow, and realized-savings history. | Close the loop from diagnosis to a measurable outcome. |
| 2:17–2:50 | Codex + repository evidence | Show one preselected public-safe Codex task view, then `README.md` and `docs/BUILD_WEEK_2026.md`. | The build story: what we built, what Codex on GPT-5.6 did, and the evidence trail. |
| 2:50–3:00 | Weekform closing frame | Return to the capacity screen or logo lockup. | Land the tagline. |

## Spoken script

Deliver deadpan. Do not laugh at your own jokes; the numbers are the punchline.

### 0:00–0:18 — The hook

> Every Sunday night, your calendar makes you a promise it has no intention of keeping. Jira knows what you planned. Outlook knows where you'll be sitting. Nothing knows what you can actually deliver. Weekform is a local-first Mac app that answers the one question that matters: what can I safely say yes to?

### 0:18–0:43 — Evidence the user controls

> It starts with limited evidence from my calendar, foreground apps, and local imports — but unlike a time tracker, these are candidates, not verdicts. Ten of twelve blocks are already reviewed. I confirm the obvious ones, relabel what the model got wrong, and exclude anything sensitive. Everything stays on this Mac. This isn't surveillance with nicer fonts — I'm the editor-in-chief of my own week.

### 0:43–1:08 — Correction changes the answer

> Here's my favorite part. This block claims it was planned work. It was actually a Teams ping that ate ninety minutes — the most expensive “quick question” of my week. I relabel it unplanned, confirm it, and watch reliable capacity drop from 24 to 17 percent — live. No hidden productivity score. The model just believed me, instantly.

### 1:08–1:38 — The commitment decision

> Now the moment every other tool dodges. Someone asks: can you take a two-day analysis next week? Asana would cheerfully add it to the board. Weekform does the math: 63 percent committed, 30 percent reactive, 17 percent dependable room after a delivery buffer. Two days is roughly 40 percent of a week. It does not fit. So I can shrink the scope, move the date, or protect capacity — before I've promised anything. That's a “no” with receipts.

### 1:38–1:58 — Uncertainty and learning

> And unlike your project plan, Weekform remembers being wrong. It knows I keep relabeling “planned” work as interruptions, and it grades its last forecast against what actually happened. It's building a track record on me — not on some benchmark human who has never been added to a recurring meeting.

### 1:58–2:17 — Close the loop

> It also hunts for time to give back. Here it spotted a Hex-to-Looker-to-Teams routine I repeat every single week, and — this is the part I like — it tracks whether acting on that actually saved time. Not another tip. A change with a measured effect.

### 2:17–2:50 — What we built, and how Codex helped

> So what did we build, and how? We built the deterministic capacity model, the review workflow, and the privacy boundary — local-first, approval-gated. Then we ran the build the way Weekform runs a week. Codex, on GPT-5.6, mapped the codebase across React and Rust, implemented focused slices, ran the gates, and critiqued the running interface. We reviewed, redirected, and approved every change — AI proposes, humans decide, in the product and in how we built it. The repo records every dated session, prototype and Build Week clearly separated.

### 2:50–3:00 — Close

> Weekform: know what fits before you say yes. Your calendar will keep lying to you — now you'll know by exactly how much.

## Recording notes

- Use `npm run demo`, then open `http://127.0.0.1:5173/?demo=1&screen=weekly`.
- Reload that URL before each take so the demo starts at 24% capacity with two unreviewed blocks.
- The browser demo does not prove native capture, menu-bar behavior, Keychain storage, macOS permissions, or native AI commands. Do not narrate it as proof of those paths.
- The preloaded forecast and acceleration examples are synthetic. Do not show real calendars, window titles, emails, prompts, API keys, customer names, or local paths.
- Use a public-safe Codex task view prepared before recording. Do not scroll through raw session files or unreviewed tool output.
- Keep the Codex description precise: Codex accelerated research, implementation, review, debugging, and validation; humans set the product constraints, reviewed the running result, and made the final decisions.
- Weekform predates Build Week. Keep the inherited baseline distinct from the dated July 13–21 work recorded in `docs/BUILD_WEEK_2026.md`.
- If the relabel interaction does not visibly change the sidebar, stop and reset the synthetic demo rather than narrating an unobserved result.
- Tool comparisons (Jira, Outlook, Asana, Teams) are contrast, not attacks. One clause each, delivered dry. Cut any joke that runs long before cutting a number.

### Audio

- The voiceover is a judging requirement: it must clearly state what we built and that Codex on GPT-5.6 was the build accelerator. Do not let the 2:17–2:50 segment get squeezed by earlier overruns.
- Record narration with an external mic in a quiet room; never the laptop's built-in mic next to a fan. Do a ten-second level test and listen back before the real take.
- Prefer recording the voiceover separately and syncing it over the screen capture — it makes the deadpan timing repeatable and lets you retake one line instead of the whole demo.
- Normalize loudness (about −16 LUFS for web video), trim breaths, and leave half a beat of silence after each punchline so it can land.
- Speak at a conversational pace; the script is sized for roughly 150 words per minute. If a segment runs long, cut jokes, not numbers.

## Preflight checklist

1. Run `npm run build` and inspect its exit status.
2. Start `npm run demo` and verify the untouched values: 24% reliable, 56% committed, 21% reactive, and two blocks awaiting review.
3. Rehearse the Planned → Unplanned correction and verify the updated values: 17% reliable, 63% committed, and 30% reactive.
4. Verify the Forecast and Accelerate screens are populated before recording.
5. Pre-open the public-safe Codex evidence and provenance sections so the final switch takes less than three seconds.
6. Enable Do Not Disturb and inspect every visible frame for real or sensitive data.
7. Check audio: external mic selected, level test recorded and reviewed, no fan or keyboard noise in the ten-second test.
8. Record one timing-only rehearsal before the final take; target 2:55–3:00 without speeding up the correction, the commitment decision, or the Codex build story.
