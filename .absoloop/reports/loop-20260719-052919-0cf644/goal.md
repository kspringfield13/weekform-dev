# /goal — Using this document, docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK.md, run the first two prompts from the runbook. Then, stop, review and analyze what’s been done and ensure PROMPT_RUNBOOK & BLUEPRINT are updated, tasks marked as done. Complete the full response to each prompt in sequence.

mission: ABS-MINIMAL-001 · loop: loop-20260719-052919-0cf644 · type: docs

## Continuation of previous run (context — the mission above is still ground truth)

This run extends loop-20260719-050445-52108e (ended COMPLETED after 3 iteration(s), $19.45).

Where the previous run left off: Iteration-3 review pass (the work the mission's "stop, review and analyze" clause and the continuation intent required) is complete, executed as a two-agent team (Builder + qa03-writer teammate). All five cross-doc inconsistencies reported by iteration 2 are resolved: (1) weekday drift — verified via `cal 7 2026` that July 19 is a Sunday; corrected seven taskboard headers/gate references (Sunday July 19 start, Monday July 20 daytime + Monday-evening Phase 2 gate/freeze) and clarified the runbook Recovery A heading; (2) unowned P0 accessibility task — teammate qa03-writer authored a full eleven-field QA-03 ledger entry (UX Critic, depends INT-02, Est 1.5h per §12 Q-03, Terra model, docs-only gates, honest BLOCKED status) plus its table row, and I added QA-03 to the §5.1 critical path; (3) dual task-ID schemes — added a complete blueprint-§12 → ledger ID mapping table to taskboard §1 (every §12 ID mapped, splits noted), verified against both tables; (4) estimate drift — taskboard declared authoritative for IDs/estimates/status, blueprint §12 banner marks it superseded-for-execution; (5) §13.4 phantom scripts — blueprint now states only `npm run build` exists (verified against package.json and by running it, exit 0) and that web:build/test:cloud are future deliverables of WEB-01/CONTRACT-03. Runbook §0 records the review pass as DONE with evidence. Definition of done: Prompts 0A/0B were completed in the prior run, this run added the mandated review/update pass as new inspectable work, and every command documented by this pass was actually run.

Operator's continuation intent: Complete from the prompt_runbook, the Wave 1 — Contracts, backend, and web foundation in parallel

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
