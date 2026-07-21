import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const agentSource = readFileSync(
  new URL("../components/PersonalAgentWorkspace.tsx", import.meta.url),
  "utf8",
);
const signupSource = readFileSync(new URL("../app/signup/page.tsx", import.meta.url), "utf8");
const invitePageSource = readFileSync(new URL("../app/invite/page.tsx", import.meta.url), "utf8");
const inviteFormSource = readFileSync(
  new URL("../app/teams/[teamId]/InviteForm.tsx", import.meta.url),
  "utf8",
);
const managerActionsSource = readFileSync(
  new URL("../app/teams/[teamId]/ManagerActionsPanel.tsx", import.meta.url),
  "utf8",
);

test("Web Agent announces only the latest settled answer outside the transcript", () => {
  assert.doesNotMatch(agentSource, /personal-agent-chat-shell[^>]*aria-live/);
  assert.match(
    agentSource,
    /className="visually-hidden"\s+role="status"\s+aria-live="polite"\s+aria-atomic="true"/,
  );
  assert.match(agentSource, /key=\{latestAgentAnnouncement\.requestId\}[\s\S]*?latestAgentAnnouncement\.answer/);
  assert.doesNotMatch(agentSource, /latestAgentAnnouncement\s*=\s*isSending/);
});

test("public and team form hints are owned by their controls", () => {
  assert.match(signupSource, /id="display-name-hint"/);
  assert.match(signupSource, /aria-describedby="display-name-hint"/);
  assert.match(signupSource, /id="password-hint"/);
  assert.match(signupSource, /aria-describedby="password-hint"/);

  assert.match(invitePageSource, /id="invite-token-hint"/);
  assert.match(invitePageSource, /aria-describedby="invite-token-hint"/);

  assert.match(inviteFormSource, /id="invite-email-hint"/);
  assert.match(inviteFormSource, /aria-describedby="invite-email-hint"/);

  assert.match(managerActionsSource, /id="manager-action-text-hint"/);
  assert.match(managerActionsSource, /aria-describedby="manager-action-text-hint"/);
  assert.match(managerActionsSource, /id="manager-action-risk-hint"/);
  assert.match(managerActionsSource, /aria-describedby="manager-action-risk-hint"/);
});

test("invite success announces concise text without making copy controls live", () => {
  assert.doesNotMatch(inviteFormSource, /className="invite-link-box"\s+role="status"/);
  assert.match(
    inviteFormSource,
    /className="invite-link-title"\s+role="status"\s+aria-live="polite"\s+aria-atomic="true"/,
  );
});
