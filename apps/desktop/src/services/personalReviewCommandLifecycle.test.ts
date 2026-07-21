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
const accountPanelSource = readFileSync(
  new URL("../components/settings/CloudAccountPanel.tsx", import.meta.url),
  "utf8",
);

function between(start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `missing ${start}`);
  assert.notEqual(to, -1, `missing ${end}`);
  return source.slice(from, to);
}

test("approval keeps legacy and v2 protocols separated before local mutation", () => {
  const approval = between("const approveCommand", "const rejectCommand");
  assert.match(approval, /command\.protocolVersion === 1/);
  assert.match(approval, /await claimReviewCommandV2/);
  assert.match(approval, /await accountRef\.current\.setPersonalSyncStateDurably/);
  const v2Approval = approval.slice(approval.indexOf("// This durable server claim"));
  assert.ok(
    v2Approval.indexOf("await claimReviewCommandV2") < v2Approval.indexOf("await accountRef.current.setPersonalSyncStateDurably"),
    "the v2 server claim must precede its durable local outbox",
  );
  assert.doesNotMatch(approval, /setBlocks\(/);
  assert.doesNotMatch(approval, /addCorrection\(/);
});

test("refresh polls immutable v1 backlog and v2 inbox, and receipt recovery never enters the local outbox", () => {
  const refresh = between("const refreshCommands", "const finishCommand");
  assert.match(refresh, /fetchPendingReviewCommandsV1/);
  assert.match(refresh, /fetchPendingReviewCommandsV2/);
  assert.match(refresh, /applicationPhase === "ack_pending"/);
  assert.match(refresh, /await claimReviewCommandV2/);
  assert.match(refresh, /Recovered a durable review receipt/);
  const recoveryStart = refresh.indexOf("foreignAckReceipts");
  const outboxStart = refresh.indexOf("ownedClaims");
  assert.ok(recoveryStart >= 0 && outboxStart >= 0);
  const recovery = refresh.slice(recoveryStart, outboxStart);
  assert.doesNotMatch(recovery, /enqueueReviewCommandApplication|mutateBlocksAtomically|addCorrection/);
});

test("outbox resumption applies locally before application and terminal acknowledgements", () => {
  const resume = between("const resumeReviewApplications", "// Flush as soon");
  assert.match(resume, /item\.command\.protocolVersion === 1/);
  assert.match(resume, /completeReviewCommandV1/);
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

test("personal operations quiesce at a shared operation boundary before reset can clear persistence", () => {
  assert.match(source, /createConnectorResetBoundary\(\)/);
  assert.match(source, /const beginOperation\s*=\s*useCallback\(\(\) => operationBoundary\.begin\(\)/);
  assert.match(source, /const quiesceForReset\s*=\s*useCallback/);
  assert.match(source, /\(\) => operationBoundary\.quiesce\(\)/);
  assert.match(source, /const resumeAfterReset\s*=\s*useCallback[\s\S]*?operationBoundary\.reopen\(\)/);
  const resume = between("const resumeReviewApplications", "// Flush as soon");
  assert.match(resume, /await claimReviewCommandV2[\s\S]*?if \(!operation\.isCurrent\(\)\) return/);
  assert.match(resume, /await persistLatestLocalState\(\)[\s\S]*?if \(!operation\.isCurrent\(\)\) return/);
  assert.match(resume, /operation\.finish\(\)/);
});

test("replica upload is fenced behind a strict durable queue and source-clock write", () => {
  const sync = between("const syncNow", "const refreshCommands");
  const materializeAt = sync.indexOf("await currentAccount.setPersonalSyncStateDurably");
  const barrierAt = sync.indexOf("await currentAccount.flushPersonalSyncState()");
  const uploadAt = sync.indexOf("await syncPersonalReplicaBatch");
  assert.ok(
    materializeAt >= 0 && barrierAt > materializeAt && uploadAt > barrierAt,
    "manual sync must durably materialize the current replica before the persistence barrier and upload",
  );
});

test("an unverifiable legacy receipt is rekeyed durably before its unchanged payload can retry", () => {
  const sync = between("const syncNow", "const refreshCommands");
  const uploadAt = sync.indexOf("await syncPersonalReplicaBatch");
  const legacyAt = sync.indexOf("LEGACY_PERSONAL_REPLICA_BATCH_ERROR", uploadAt);
  const rekeyAt = sync.indexOf("rekeyLegacyReplicaBatch", legacyAt);
  const durableAt = sync.indexOf("await currentAccount.setPersonalSyncStateDurably", rekeyAt);
  const recoveryReturnAt = sync.indexOf("return false", durableAt);
  assert.ok(
    uploadAt >= 0 && legacyAt > uploadAt && rekeyAt > legacyAt
      && durableAt > rekeyAt && recoveryReturnAt > durableAt,
    "legacy recovery must persist a fresh retry key and stop before another upload",
  );
  assert.match(sync.slice(rekeyAt, recoveryReturnAt), /current\.queue/);
});

test("manual replica sync exposes a terminal success notice only after a server receipt", () => {
  const sync = between("const syncNow", "const refreshCommands");
  const uploadAt = sync.indexOf("await syncPersonalReplicaBatch");
  const receiptAt = sync.indexOf("lastSuccessAt = result.value.syncedAt", uploadAt);
  const noticeAt = sync.indexOf("Web updated successfully", receiptAt);
  assert.ok(
    uploadAt >= 0 && receiptAt > uploadAt && noticeAt > receiptAt,
    "success notice must follow a validated server receipt",
  );
  assert.match(source, /lastNotice:\s*string \| null/);
  assert.match(accountPanelSource, /cloud\.personal\.lastNotice/);
  assert.match(accountPanelSource, /role="status"/);
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
