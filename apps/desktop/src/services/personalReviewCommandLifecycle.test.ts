import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../hooks/usePersonalCloudSync.ts", import.meta.url),
  "utf8",
);
const accountSource = readFileSync(
  new URL("../hooks/useCloudAccount.ts", import.meta.url),
  "utf8",
);

function between(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test("approval obtains a server claim and queues durable work without mutating local truth", () => {
  const approval = between("const approveCommand", "const rejectCommand");
  assert.match(approval, /await claimReviewCommandV2/);
  assert.match(approval, /await accountRef\.current\.setPersonalSyncStateDurably/);
  assert.ok(
    approval.indexOf("await claimReviewCommandV2") < approval.indexOf("await accountRef.current.setPersonalSyncStateDurably"),
    "the server claim must precede the durable local outbox",
  );
  assert.doesNotMatch(approval, /setBlocks\(/);
  assert.doesNotMatch(approval, /addCorrection\(/);
});

test("outbox resumption applies locally before application and terminal acknowledgements", () => {
  const resume = between("const resumeReviewApplications", "// Flush as soon");
  const applyAt = resume.indexOf("mutateBlocksAtomically(");
  const durableAckAt = resume.indexOf("await currentAccount.setPersonalSyncStateDurably", applyAt);
  const localBarrierAt = resume.indexOf("await persistLatestLocalState", durableAckAt);
  const cloudBarrierAt = resume.indexOf("await currentAccount.flushPersonalSyncState", durableAckAt);
  const markAt = resume.indexOf("await markReviewCommandAppliedLocallyV2");
  const completeAt = resume.indexOf("await completeReviewCommandV2", markAt);
  assert.ok(applyAt >= 0, "outbox must own the local mutation edge");
  assert.ok(durableAckAt > applyAt, "ack_pending must be durable after the local mutation edge");
  assert.ok(localBarrierAt > durableAckAt && localBarrierAt < markAt, "latest blocks and corrections must be durable before server acknowledgement");
  assert.ok(cloudBarrierAt > durableAckAt && cloudBarrierAt < markAt, "ack_pending must be durably flushed before server acknowledgement");
  assert.ok(markAt > applyAt, "the server application receipt must follow local application");
  assert.ok(completeAt > markAt, "terminal acknowledgement must follow the application receipt");
  assert.match(resume, /markReviewCommandApplicationPhase[\s\S]*?"ack_pending"/);
  assert.match(resume, /applyReviewCommandToCurrentBlocks/);
  assert.doesNotMatch(resume, /setBlocks\(/);
});

test("personal operations quiesce at an epoch boundary before reset can clear persistence", () => {
  assert.match(source, /const quiesceForReset\s*=\s*useCallback/);
  assert.match(source, /operationEpochRef\.current \+= 1/);
  assert.match(source, /await Promise\.allSettled\(\[\.\.\.activeOperationCompletionsRef\.current\]\)/);
  const resume = between("const resumeReviewApplications", "// Flush as soon");
  assert.match(resume, /await claimReviewCommandV2[\s\S]*?if \(!operation\.isCurrent\(\)\) return/);
  assert.match(resume, /await persistLatestLocalState\(\)[\s\S]*?if \(!operation\.isCurrent\(\)\) return/);
  assert.match(resume, /operation\.finish\(\)/);
});

test("replica upload is fenced behind a strict durable queue and source-clock write", () => {
  const sync = between("const syncNow", "const refreshCommands");
  const barrierAt = sync.indexOf("await currentAccount.flushPersonalSyncState()");
  const uploadAt = sync.indexOf("await syncPersonalReplicaBatch");
  assert.ok(barrierAt >= 0 && uploadAt > barrierAt);
});

test("account reset invalidates deferred auth and refresh completions", () => {
  assert.match(accountSource, /accountEpochRef/);
  assert.match(accountSource, /epoch !== accountEpochRef\.current/);
  const clearStart = accountSource.indexOf("const clearAll");
  const clearEnd = accountSource.indexOf("const account =", clearStart);
  const clear = accountSource.slice(clearStart, clearEnd);
  assert.match(clear, /accountClearInFlightRef\.current = true/);
  assert.match(clear, /accountEpochRef\.current \+= 1/);
  assert.match(clear, /await clearPersistedCloudState\(\)/);
  assert.match(clear, /accountClearInFlightRef\.current = false/);
});

test("sign-out refuses to discard a non-empty review outbox", () => {
  const signOutStart = accountSource.indexOf("const signOut");
  const signOutEnd = accountSource.indexOf("const refreshTeams", signOutStart);
  const signOut = accountSource.slice(signOutStart, signOutEnd);
  const guardAt = signOut.indexOf("personalSyncDisconnectBlockReason");
  const clearAt = signOut.indexOf("setSession(null)");
  assert.ok(guardAt >= 0 && clearAt > guardAt, "disconnect guard must run before session state is cleared");
  assert.match(signOut, /setAuthError\(disconnectBlockReason\)/);
  assert.match(signOut, /return false/);
});
