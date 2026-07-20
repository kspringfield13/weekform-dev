# Iteration 3 Settings independent critic

Date: 2026-07-20  
Verdict: **APPROVE — bounded Individual Settings density, action hierarchy, and responsive source-parity slice only**

The initial implementation was not approved. Independent review found that Data Control still repeated three per-row Mac acquisition links even though the new action-density contract omitted that tab, and that the density contract accepted Web row values that differed from Desktop's effective winning tokens. The repair brought Data Control into the shared pattern, protected its real Web deletion path, aligned all five local-control surfaces to the Desktop row tokens, and tightened the contracts before this verdict.

## Final findings

- Settings now keeps Desktop's stable page-heading distinction: `Privacy and data sources` for the five non-account tabs and `Account & sharing` for the operational account tab. Tab selection no longer replaces the page title with each subsection label.
- Data Sources, Data Control, AI Assistance, AI Usage, and Notifications use the Desktop's effective row density: 80 px minimum height, 12 px / 8 px inset, 13 px / 18 px body copy, 11 px secondary status copy, a 34 px icon column, and the four-part icon/copy/status/control grid.
- Mac-owned row controls retain the Desktop control footprint as inert, explicitly disabled labels. They do not submit, navigate, claim success, or imply that Web can mutate local capture, credentials, retention, export, reset, usage, or notification state.
- Each local-control tab now has one terminal Weekform for Mac handoff instead of an acquisition button on every row. The repeated-CTA defect is closed on Data Control as well as the four presentation-only tabs.
- Data Control preserves its separate operational `deletePersonalReplicaHistory` form, confirmation copy, pending label, and destructive styling. The repair changes only the three Mac-owned retention/export/reset rows and cannot silently demote the authorized Web deletion into a Mac handoff.
- All six tabs retain labelled tabpanels, allowlisted query routing, browser Back/Forward reconciliation, roving focus, and Manager-independent content ownership. No API, Supabase, auth, replica, browser-storage, or Manager Access seam was added.
- The row grids collapse from four columns to icon/copy/control and then icon/copy layouts; the shared terminal handoff stacks at 620 px. Focus styling continues to use the authenticated shell's existing Geist token contract.

## Independent verification

```text
node --import tsx --test \
  apps/web/lib/individualAISettingsOperationalParity.test.ts \
  apps/web/lib/individualAISettingsParity.test.ts \
  apps/web/lib/individualDataControlParity.test.ts \
  apps/web/lib/individualDataSourcesParity.test.ts \
  apps/web/lib/individualHistorySettingsParity.test.ts \
  apps/web/lib/individualNotificationsParity.test.ts \
  apps/web/lib/individualSettingsActionDensityParity.test.ts \
  apps/web/lib/individualSettingsDensityParity.test.ts \
  apps/web/lib/individualSettingsNavigationParity.test.ts \
  apps/web/lib/individualSettingsTabPanelParity.test.ts

34 passed, 0 failed
```

```text
git diff --check -- <scoped Settings implementation and contract files>
exit 0
```

`npm --prefix apps/web run typecheck` was also attempted independently. It is currently red in concurrent work outside this slice: `distributedRequestControl.test.ts` imports a missing module and has implicit-any callback parameters, while `webexTokenBroker.test.ts` expects exports and a `controlClaim` field not present in its implementation contract. No reported TypeScript error names a Settings artifact. This approval therefore does not claim a green standing typecheck.

## Approval boundary

This verdict approves the new bounded Settings source slice, not route-wide pixel parity or the overall mission. Authenticated matched screenshots for every tab in light and dark at 1440 x 900 and 1024 x 720, runtime console and computed-layout proof, resolution of the concurrent Web typecheck failures, remaining route polish, and human operator approval are still required. No rendered or pixel-perfect claim is made here.
