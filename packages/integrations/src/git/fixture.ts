// Sample git-log export used to exercise the parser in `gitLog.ts` (there is no
// automated test runner). Produced by:
//   git log --pretty=format:'%H|%aI|%an|%s'
// with two repos concatenated under `# repo:` directives. Mirrors the way
// `calendar/outlookIcs.ts` is validated against representative input.
//
// Shape exercised by this fixture:
//   - clear-capacity: a morning burst (4 commits within minutes → one session)
//     and an afternoon burst >90min later (→ a second session), incl. a squash
//     merge subject with a `(#NN)` PR ref and a `|` inside a subject.
//   - analytics-pipeline: a single commit (→ a lone-commit block) plus a merge
//     commit carrying a `Merge pull request #NN` PR ref.
//   - a malformed line (too few fields) and a bad-date line that must be dropped.

export const SAMPLE_GIT_LOG = `# repo: clear-capacity
9f3a1b2c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f90|2026-06-22T09:02:00Z|Dana Lee|Add forecast accuracy trend
a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0|2026-06-22T09:18:00Z|Dana Lee|Wire trend into useDerived
b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1|2026-06-22T09:41:00Z|Dana Lee|Refactor: split parser | mapper helpers
c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2|2026-06-22T10:05:00Z|Dana Lee|Tune baseline minutes (#214)
d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3|2026-06-22T14:30:00Z|Dana Lee|Start git-log import module
e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4|2026-06-22T15:12:00Z|Dana Lee|Add session grouping
# repo: analytics-pipeline
f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5|2026-06-23T11:00:00Z|Sam Ortiz|Backfill Q2 revenue model
07b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6|2026-06-23T16:45:00Z|Sam Ortiz|Merge pull request #98 from feature/etl-retry
this-line-is-malformed-and-should-be-dropped
18c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7|not-a-date|Sam Ortiz|Bad timestamp, dropped`;
