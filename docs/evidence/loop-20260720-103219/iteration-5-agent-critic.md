# Iteration 5 — Independent Ask parity critic

Date: 2026-07-20  
Verdict: **APPROVE**

The critic initially rejected the Mac-handoff state because the action card was nested inside the normal assistant row, producing both a 28 px assistant avatar and a 32 px action icon. The `/download` control also lacked the Desktop action-pill footprint.

After repair, the critic verified:

- `mac_handoff` is a standalone card sibling with one action icon;
- the card uses the Desktop 32 px / flexible copy / control grid, 720 px maximum width, 38 px offset, and 12 px radius;
- `/download` is a focused, bordered 30 px pill;
- no approve, confirm, execute, or other Web mutation handler exists;
- empty, sending, conversation, failure, keyboard, hover, and focus states satisfy the bounded Desktop contract;
- the browser sends only `{ question }`, conversation state stays mounted and temporary, and Manager Access is unchanged.

Independent checks reported by the critic:

- focused Ask suites: `39/39` PASS;
- Web typecheck: PASS;
- scoped diff check: PASS.

No files were edited by the critic. Authenticated matched screenshots remain a separate environment-blocked proof surface.
