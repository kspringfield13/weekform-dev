# /goal — Using this document, docs/WEEKFORM_CODEX_PARALLEL_PROMPT_RUNBOOK.md, run the first two prompts from the runbook. Then, stop, review and analyze what’s been done and ensure PROMPT_RUNBOOK & BLUEPRINT are updated, tasks marked as done. Complete the full response to each prompt in sequence.

mission: ABS-MINIMAL-001 · loop: loop-20260718-195338-2a8640 · type: docs

## Success condition (the only thing that ends this loop)

You report the mission done ("done": true in your JSON result) with
evidence, an independent critic finds no blocking issue, and the human operator approves the result.
A done claim without evidence counts for nothing — the critic inspects
the working tree itself and rejects unearned claims.

No "done": true report is accepted before iteration 3 — every earlier iteration must add a demonstrable improvement.

## Definition of done

- The objective is achieved and demonstrated in the working tree.
- An independent critic finds no blocking issue.
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
