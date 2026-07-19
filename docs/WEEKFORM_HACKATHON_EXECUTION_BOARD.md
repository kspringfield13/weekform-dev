# Weekform Team Cloud — Hackathon Execution Board

**Start:** Saturday, July 18, 2026  
**Feature freeze:** Monday, July 20 at 9:00 PM EDT  
**Internal submission:** Tuesday, July 21 at 3:00 PM EDT  
**Hard deadline:** Tuesday, July 21 at 8:00 PM EDT

## Status legend

- `READY` — dependency and scope are clear.
- `ACTIVE` — one named writer owns it.
- `REVIEW` — implementation exists; evidence/critic pending.
- `DONE` — acceptance evidence is attached.
- `BLOCKED` — blocker and fallback named.
- `CUT` — intentionally removed from submission.

## Product success metric

The build is winning when this complete loop works twice from clean synthetic state:

```text
manager account → team → invite → member account → authenticated download
→ desktop login → exact privacy preview → manual sync → manager dashboard
→ grounded briefing/fallback → member removes data → manager view honors it
```

---

## Critical-path board

| ID | Status | Work item | Owner | Depends on | Evidence required | Est. |
|---|---|---|---|---|---|---:|
| DIR-01 | READY | Freeze P0/P1/P2 and demo story | Program Director | — | Approved product contract | 1.0h |
| DIR-02 | BLOCKED | Freeze cloud field names and share levels | Program Director | DIR-01 | `CloudSharePolicyV1`, `SharedWorkloadSnapshotV1` | 1.0h |
| ENV-01 | READY | Create Supabase project and env inventory | Cloud Lead | DIR-01 | Project ref stored outside repo; env templates | 0.5h |
| ENV-02 | READY | Deploy empty Vercel web shell | Web Lead | DIR-01 | Reachable preview URL | 0.5h |
| CONTRACT-01 | BLOCKED | Add cloud domain types | Contract Agent | DIR-02 | Typecheck | 1.0h |
| CONTRACT-02 | BLOCKED | Build allowlist snapshot + preview + fingerprint | Contract Agent | CONTRACT-01 | Safe serialized fixture | 2.0h |
| CONTRACT-03 | BLOCKED | Add ten privacy/contract tests | Contract Agent | CONTRACT-02 | Passing focused command | 1.5h |
| DB-01 | BLOCKED | Create profiles/teams/memberships/invites/snapshots migration | Cloud Agent | DIR-02,ENV-01 | Reviewed SQL migration | 2.0h |
| DB-02 | BLOCKED | Add RLS/helper functions/indexes | Cloud Agent | DB-01 | Four-actor RLS matrix | 2.0h |
| DB-03 | BLOCKED | Add create-team and accept-invite RPCs | Cloud Agent | DB-02 | Positive/negative invite results | 1.5h |
| DB-04 | BLOCKED | Create synthetic team seed procedure | Cloud Agent | DB-01 | Three safe demo identities | 1.0h |
| WEB-01 | READY | Scaffold Next.js + Supabase SSR | Web Agent | ENV-01 | `web:build` passes | 1.5h |
| WEB-02 | READY | Build landing/account CTA/privacy story | Web Agent | WEB-01 | Responsive screenshots | 2.5h |
| WEB-03 | BLOCKED | Signup/login/logout/profile | Web Agent | WEB-01,DB-01 | Auth smoke evidence | 2.0h |
| WEB-04 | BLOCKED | Role-aware onboarding/create team | Web Agent | WEB-03,DB-03 | Owner membership exists | 2.0h |
| WEB-05 | BLOCKED | Invite link and accept route | Web Agent | WEB-04,DB-03 | Second account joins | 2.5h |
| WEB-06 | BLOCKED | Authenticated download route/page | Web Agent | WEB-03 | Signed-in succeeds; signed-out denied | 1.5h |
| DESK-01 | BLOCKED | Desktop cloud account service/auth | Desktop Agent | WEB-03,CONTRACT-01 | Same account signs in on Mac | 2.5h |
| DESK-02 | BLOCKED | Account & Sharing tab and policy editor | Desktop Agent | DESK-01,CONTRACT-01 | Sharing defaults off | 3.0h |
| DESK-03 | BLOCKED | Exact preview and consent | Desktop Agent | DESK-02,CONTRACT-02 | Preview equals upload object | 1.5h |
| DESK-04 | BLOCKED | Persist/parse/reset/export cloud state | Desktop Agent | DESK-01,CONTRACT-01 | Old local state hydrates; tokens excluded | 3.0h |
| DESK-05 | BLOCKED | Manual RLS snapshot sync and local audit | Desktop Agent | DESK-03,DESK-04,DB-02 | One authenticated row inserted | 3.0h |
| DASH-01 | BLOCKED | Manager latest-snapshot query and team aggregates | Web Agent | WEB-04,DESK-05 | Correct manager-only rows | 2.0h |
| DASH-02 | BLOCKED | Manager dashboard/member cards/states | Web Agent | DASH-01 | Partial/stale/not-shared UI | 2.5h |
| DASH-03 | BLOCKED | Member personal dashboard | Web Agent | WEB-03,DESK-05 | Own snapshot only | 1.5h |
| PRIV-01 | BLOCKED | Disable metric, resync, show omission | Integrator | DESK-05,DASH-02 | Manager sees `Not shared` | 1.0h |
| PRIV-02 | BLOCKED | Delete cloud history/disconnect | Desktop+Web | DESK-05,DASH-02 | Rows gone; scheduler stopped | 1.5h |
| QA-01 | BLOCKED | Execute four-actor RLS negative matrix | Privacy Critic | DB-02,DASH-01 | Actual allow/deny log | 2.0h |
| QA-02 | BLOCKED | Audit serialized payload for forbidden data | Privacy Critic | CONTRACT-03,DESK-05 | No sensitive sentinel found | 1.0h |
| INT-01 | BLOCKED | Merge P0 in contract-first order | Integrator | All P0 implementations | Clean integration branch | 2.5h |
| INT-02 | BLOCKED | Golden path run 1 | Integrator | INT-01 | Screen recording/checklist | 1.0h |
| INT-03 | BLOCKED | Golden path run 2 from reset | Integrator | INT-02 fixes | Independent pass | 1.0h |
| REL-01 | BLOCKED | Web production build/deploy | Release Lead | INT-01 | Live URL + build output | 1.0h |
| REL-02 | BLOCKED | Desktop build/source artifact | Release Lead | INT-01 | Installable ZIP/source installer | 2.0h |
| SUB-01 | BLOCKED | README/privacy/provenance final | Submission Lead | INT-03 | Claims match implementation | 2.0h |
| SUB-02 | BLOCKED | Demo video and captions | Submission Lead | INT-03,REL-01,REL-02 | 3.5–4 minute video | 2.5h |
| SUB-03 | BLOCKED | Devpost fields and `/feedback` verification | Submission Lead | SUB-01,SUB-02 | Submission preview | 1.0h |
| SUB-04 | BLOCKED | Submit by 3 PM EDT | Human owner | SUB-03 | Devpost confirmation | 0.5h |

---

## P1 board — only after two P0 passes

| ID | Status | Work item | Owner | Depends on | Evidence | Est. |
|---|---|---|---|---|---|---:|
| SYNC-01 | BLOCKED | Hourly interval while app runs | Desktop Agent | DESK-05 | Timed test/clock fixture | 1.5h |
| SYNC-02 | BLOCKED | Startup catch-up and content no-op | Desktop Agent | SYNC-01 | Old sync catches up; unchanged skips | 1.0h |
| SYNC-03 | BLOCKED | 1/5/15 retry and cancellation | Desktop Agent | SYNC-01 | Retry ID stable; disable cancels | 1.5h |
| AI-01 | BLOCKED | Deterministic team risks/aggregates | Web Agent | DASH-01 | Fixture output | 1.5h |
| AI-02 | BLOCKED | Structured Team Briefing server route | AI Agent | AI-01 | Schema/prompt tests | 2.0h |
| AI-03 | BLOCKED | Briefing UI and deterministic fallback | AI Agent | AI-02 | Failure still yields useful briefing | 1.0h |
| INV-EMAIL | BLOCKED | Optional invite email | Web Agent | WEB-05 | Email or logged fallback | 1.0h |
| HISTORY-01 | BLOCKED | Member/team snapshot trend | Web Agent | DASH-01 | 7-day fixture | 2.0h |

---

## Hard cut list

Mark these `CUT` unless every P0 item is `DONE`:

- Realtime subscriptions.
- Billing/subscriptions.
- SSO/SCIM.
- Slack/Jira/Linear OAuth.
- Global role/admin console.
- Manager-enforced sharing.
- Raw work-block cloud storage.
- Deep-link OAuth.
- Signed/notarized updater.
- Mobile/Windows.
- Performance rankings/benchmarks.
- Automatic work allocation.
- Full background sync after app quit.

---

## Daily operating cadence

### Saturday, July 18

- **Checkpoint 1:** Contract/RLS/web environment decisions frozen.
- **Checkpoint 2:** Contract, migration, and web auth foundation all have artifacts.
- **End-of-day gate:** No implementation team is waiting on an unnamed field/table/role.

### Sunday, July 19

- **Morning:** Auth, create team, invite acceptance.
- **Afternoon:** Desktop preview and first manual snapshot.
- **Evening:** Manager reads the row; member/outsider denial proven.
- **End-of-day gate:** The vertical slice exists without AI or hourly sync.

### Monday, July 20

- **Morning:** Dashboard, revoke/delete, failure states.
- **Afternoon:** P1 hourly sync and Team Briefing only if P0 passed.
- **9:00 PM EDT:** Feature freeze; incomplete UI removed or flagged off.

### Tuesday, July 21

- **8 AM–12 PM:** Regression, privacy review, build artifacts.
- **12–3 PM:** Video, README, Devpost, provenance.
- **3 PM:** Internal submission.
- **8 PM:** Hard deadline, not the target.

---

## Evidence ledger template

Use one row per task/mission:

| Task | Branch/commit | Codex session | Commands + exit | Manual evidence | Privacy impact | Reviewer | Decision |
|---|---|---|---|---|---|---|---|
| Example | `codex/...` | `019...` | `npm run ...` = 0 | Screenshot/row ID | Derived only | Session/critic | Merge/Cut |

Never put secrets, raw prompts, local paths, real data, or private cost records in the public evidence ledger.

---

## Stop-the-line conditions

Immediately stop integration when:

- an outsider can read a team or snapshot;
- a member can read a peer snapshot;
- raw titles/evidence/notes appear in payload;
- a service/secret key appears in client code or bundle;
- reset/sign-out leaves scheduled uploads active;
- the manager dashboard treats missing as zero;
- an AI response ranks or evaluates employees;
- the existing local demo/build no longer works;
- a gate was skipped but reported as passing.
