# /goal — Using this document, docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK.md, run the first two prompts from the runbook. Then, stop, review and analyze what’s been done and ensure PROMPT_RUNBOOK & BLUEPRINT are updated, tasks marked as done. Complete the full response to each prompt in sequence.

mission: ABS-MINIMAL-001 · loop: loop-20260719-105239-1d2f48 · type: docs

## Continuation of previous run (context — the mission above is still ground truth)

This run extends loop-20260719-104758-a238a2 (ended BUDGET_EXHAUSTED after 50 iteration(s), $0.00).

Where the previous run left off: You've hit your session limit · resets 1:10pm (America/New_York)

Operator's continuation intent: Execute Prompts 13 and 14 from docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK_PT2.md in sequence, completing and verifying each before the next. Then stop, review the combined result, rerun all standing gates, and update PT2, the blueprint, and roadmap with accurate completion status, evidence, and remaining gaps.

The previous run's work is already in the working tree. Build on it — inspect what exists before editing, and do not redo or revert it.

The original definition of done was already met by the previous run. This run is NOT done until the operator's continuation intent above is satisfied by new, inspectable work — confirming that the previous result still exists counts for nothing.

## Success condition (the only thing that ends this loop)

You report the mission done ("done": true in your JSON result) with
evidence, an independent critic finds no blocking issue, and the human operator approves the result.
A done claim without evidence counts for nothing — the critic inspects
the working tree itself and rejects unearned claims.

No "done": true report is accepted before iteration 3 — every earlier iteration must add a demonstrable improvement.

## Definition of done

- The objective is achieved and demonstrated in the working tree.
- An independent critic finds no blocking issue.
- Extension requirement (loop-20260719-050445-52108e): Continue with prompt_runbook — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-052919-0cf644): Complete from the prompt_runbook, the Wave 1 — Contracts, backend, and web foundation in parallel — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-055300-166f58): Review, finalized Wave 1 and then proceed with Wave 2 prompts — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-065525-403d03): Proceed with Wave 2 from prompt_runbook — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-071047-7592e7): Proceed on to Wave 3 — Completeness and intelligence execution. — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-080950-755c05): Continue with Wave 1-3 validation and review for any issues or discrepancies.  Make updates where needed for optimal ops and UI. — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-081420-ba53ab): Building on the completed pass for “Using this document, docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK.md, run the first two prompts from the runbook. Then…”, take the next highest-leverage polish or adjacent capability (critic: Independently reproduced every documented gate: verify:wave3 exit 0 (55/55 desktop-cloud tests, 85/85 web tests, 12 routes / 11 static pages including the ne…). Keep gates green and leave a crisp operator-facing summary. — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-081455-c0b251): Proceed on to Wave 3 — Completeness and intelligence execution. — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-085257-7690b4): Execute runbook prompts 11 and 12 sequentially, completing and validating each before moving on. Run the full Wave 4 verification gate, update PROMPT_RUNBOOK and BLUEPRINT with evidence and final task states, and document any environment-blocked live RLS proof without claiming it passed. — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-092551-3a0e37): Close the remaining Wave 4 readiness gaps: triage and remediate npm audit without regressions, execute the live four-actor RLS checks and golden path twice, and capture reproducible evidence. Update the runbook, blueprint, taskboard, release report, and Devpost package with verified outcomes; keep any still-blocked claims explicitly hedged. — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-093522-27cfe6): Skip doing demos. We need to keep building. Move on to part 17. Post-hackathon expansion roadmap in WEEKFORM_TEAM_CLAWFATHER_HACKATHON_BLUEPRINT.md.  Create a more detailed, phased plan and then execute it immediately with flawless and optimal high quality Weekform standardized with epic capability results. — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-101318-ee04ec): Need to do a full analysis, comparing current state with Blueprint definition and mission. Then create a new  WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK_PT2 document that achieves a new level of highest quality Weekform user experience and capabilities that meet and exceed the missions and original definitions. — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-102937-ac1403): Start the work & intense implementation with robustness on WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK_PT2 document — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-104758-a238a2): Continue “Using this document, docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK.md, run the first two prompts from the runbook. Then…” from the last checkpoint with a tighter slice: finish the nearest incomplete deliverable, verify gates, and stop with a clear PASS. — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Extension requirement (loop-20260719-105239-1d2f48): Execute Prompts 13 and 14 from docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK_PT2.md in sequence, completing and verifying each before the next. Then stop, review the combined result, rerun all standing gates, and update PT2, the blueprint, and roadmap with accurate completion status, evidence, and remaining gaps. — the previous run's existing result does not satisfy this by itself; this run must demonstrably advance it with new, inspectable work.
- Every documented command and example actually runs as written.

## Strategy ladder (one bounded strategy per iteration)

1. Verify claims against the code before writing them down.
2. Run every example command you document.

## Constraints

- Never weaken, skip, or delete tests or acceptance criteria to make the mission look done — that is mission failure, not success.
- Stay mission-scoped — no opportunistic edits outside the contract. Scoped does NOT mean solo: on multi-file or larger builds the Builder must spawn an agent team and coordinate, not implement everything alone.
- Do not push, publish, deploy, or perform destructive or external actions — delivery is handled by the loop after acceptance.
- Report "done": true only with evidence; the critic and human gate make the final call.

## Builder as team lead

The Absoloop Builder is the team lead for this mission. On complex or multi-component work it must spawn native teammates / subagents (Claude Agent Teams via the Task tool, Codex subagents, or Grok `spawn_subagent`), assign clear owned slices, and synthesize — not solo the entire build. Solo only true one-file / one-function fixes.

## Skills — the mission's capability pipeline

Reusable skills live in your engine's skills directory in this project
(`.claude/skills/` / `.codex/skills/` / `.grok/skills/` — the
iteration prompt lists what is installed). A standard toolbox is
seeded at setup (skill-creator, ai-ready, tdd, agent-browser,
mcp-builder, frontend-design, plus engine-specific references); skills
persist across iterations and are how the loop compounds learning
instead of re-deriving it. Standard procedure every iteration:

- Before working, check the available skills and apply any that fit
  the task at hand — read a skill's SKILL.md before relying on it.
- When you hit recurring complexity — a multi-step procedure done
  twice, a helper script rewritten, a failure caused by a missing
  capability, non-obvious domain knowledge worth keeping — use the
  `skill-creator` skill to create or enhance a skill, then use it.
- Skill files are authorized mission infrastructure: creating or
  improving them is inside scope, but only ever in service of this
  contract. Report them in changed_artifacts like any other change.

## Thinking escalation (repeated-failure count → depth)

| repeats | claude | thinking tokens | codex effort | budgets | posture |
|---|---|---|---|---|---|
| 0 (fresh evidence) | think | 4000 | medium | ×1 | Plan briefly, act on the strongest hypothesis. |
| 1 (first repeat) | think hard | 10000 | high | ×1.25 | The obvious fix failed once — re-derive the failure from evidence before editing. |
| 2 (second repeat) | think harder | 16000 | high | ×1.5 | Two identical failures — your model of the problem is wrong. Enumerate at least three distinct hypotheses and test the most falsifiable one. |
| 3+ (final window) | ultrathink | 31999 | high | ×2 | Last chance before the loop blocks. Step back to first principles, question your assumptions about the mission, and consider whether it needs operator input. |

## Delivery (applied by the loop after acceptance — never by you)

- mode: **local** — leave changes unstaged in the working tree (you commit yourself)
