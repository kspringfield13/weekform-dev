import test from "node:test";
import assert from "node:assert/strict";

import { PERSONA_CATALOG, getPersona } from "./personas";
import { GOLDEN_SIMULATION_CONFIG } from "./golden";
import {
  advanceSimulation,
  createSimulationCheckpoint,
  replayMatches,
  runSimulationToCompletion,
  validateSimulationConfig,
} from "./engine";
import { validateSimulationDataset } from "./validate";
import {
  authenticateLocalSimulatorAdmin,
  authorizeSimulatorAccess,
  getLocalAdminPortalView,
  getLocalSimulatorAccessContext,
  LOCAL_SIMULATOR_ADMIN_EMAIL,
  LOCAL_SIMULATOR_ADMIN_PASSWORD
} from "./authorization";
import { buildLocalPlaybackPlan, isAllowedPlaybackUrl } from "./playback";
import { serializeSimulationJson, serializeWeeklySnapshotsCsv } from "./export";
import { simulationEndDate, zonedDateTimeToIso } from "./clock";
import { sha256 } from "./canonical";

const REQUIRED_PERSONAS = [
  "Data Analyst",
  "Software Engineer",
  "Product Manager",
  "Product Designer",
  "Customer Support Lead",
  "Sales Account Executive",
  "Marketing Manager",
  "Finance Analyst",
  "Operations Manager",
  "Consultant",
];

test("starter catalog ships ten versioned, schema-valid professional personas", () => {
  assert.deepEqual(PERSONA_CATALOG.map((persona) => persona.role), REQUIRED_PERSONAS);
  for (const persona of PERSONA_CATALOG) {
    assert.equal(persona.schemaVersion, 1);
    assert.match(persona.version, /^\d+\.\d+\.\d+$/);
    assert.ok(persona.responsibilities.length >= 4);
    assert.ok(persona.projects.length >= 3);
    assert.ok(persona.appContexts.length >= 4);
    assert.equal(persona.categoryWeights.reduce((total, item) => total + item.weight, 0), 100);
    assert.equal(persona.modeWeights.reduce((total, item) => total + item.weight, 0), 100);
  }
  assert.equal(getPersona("data-analyst")?.displayName, "Senior Data Analyst");
});

test("golden configuration is a valid 26-week New York simulation", () => {
  const validation = validateSimulationConfig(GOLDEN_SIMULATION_CONFIG);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(GOLDEN_SIMULATION_CONFIG.span.value, 26);
  assert.equal(GOLDEN_SIMULATION_CONFIG.span.unit, "weeks");
  assert.equal(GOLDEN_SIMULATION_CONFIG.timezone, "America/New_York");
  assert.equal(GOLDEN_SIMULATION_CONFIG.seed, "20260718");
});

test("virtual clock preserves local wall time across New York daylight saving time", () => {
  assert.equal(zonedDateTimeToIso("2026-03-06", "09:00", "America/New_York"), "2026-03-06T14:00:00.000Z");
  assert.equal(zonedDateTimeToIso("2026-03-09", "09:00", "America/New_York"), "2026-03-09T13:00:00.000Z");
  assert.equal(simulationEndDate({ ...GOLDEN_SIMULATION_CONFIG, startDate: "2026-01-31", span: { value: 1, unit: "months" } }), "2026-02-28");
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

test("same canonical inputs replay exactly while a different seed changes output", () => {
  const first = runSimulationToCompletion(GOLDEN_SIMULATION_CONFIG);
  const replay = runSimulationToCompletion({ ...GOLDEN_SIMULATION_CONFIG });
  const changed = runSimulationToCompletion({ ...GOLDEN_SIMULATION_CONFIG, seed: "20260719" });

  assert.equal(first.canonicalFingerprint, replay.canonicalFingerprint);
  assert.deepEqual(first.artifacts, replay.artifacts);
  assert.equal(replayMatches(first, replay), true);
  assert.notEqual(first.canonicalFingerprint, changed.canonicalFingerprint);
});

test("golden run reuses real Weekform sessionization and capacity inference", () => {
  const dataset = runSimulationToCompletion(GOLDEN_SIMULATION_CONFIG);
  assert.equal(dataset.weeklySnapshots.length, 26);
  assert.ok(dataset.artifacts.activitySessions.length > 0);
  assert.ok(dataset.artifacts.workBlocks.length > 0);
  assert.ok(dataset.artifacts.narratives.length > 0);
  assert.ok(dataset.artifacts.accelerationSignals.length > 0);
  assert.ok(dataset.provenance.includes("sessionizeActiveWindowSamples"));
  assert.ok(dataset.provenance.includes("computeWeeklyCapacitySnapshot"));
  for (const snapshot of dataset.weeklySnapshots) {
    assert.equal(snapshot.stamp.isSynthetic, true);
    assert.equal(snapshot.payload.week_id, snapshot.weekId);
  }
});

test("week-chunk resume produces the same canonical dataset as one-shot generation", () => {
  let checkpoint = createSimulationCheckpoint(GOLDEN_SIMULATION_CONFIG);
  checkpoint = advanceSimulation(GOLDEN_SIMULATION_CONFIG, checkpoint, 7);
  assert.equal(checkpoint.nextWeekIndex, 7);
  checkpoint = advanceSimulation(GOLDEN_SIMULATION_CONFIG, checkpoint, 19);
  assert.equal(checkpoint.status, "complete");
  assert.ok(checkpoint.dataset);

  const oneShot = runSimulationToCompletion(GOLDEN_SIMULATION_CONFIG);
  assert.equal(checkpoint.dataset?.canonicalFingerprint, oneShot.canonicalFingerprint);
  assert.deepEqual(checkpoint.dataset?.artifacts, oneShot.artifacts);
});

test("cancellation preserves a resumable checkpoint without completing the run", () => {
  const initial = createSimulationCheckpoint(GOLDEN_SIMULATION_CONFIG);
  const canceled = advanceSimulation(GOLDEN_SIMULATION_CONFIG, initial, 4, { cancel: true });
  assert.equal(canceled.status, "canceled");
  assert.equal(canceled.nextWeekIndex, 4);
  assert.equal(canceled.dataset, null);

  const resumed = advanceSimulation(GOLDEN_SIMULATION_CONFIG, { ...canceled, status: "running" }, 22);
  assert.equal(resumed.status, "complete");
  assert.equal(
    resumed.dataset?.canonicalFingerprint,
    runSimulationToCompletion(GOLDEN_SIMULATION_CONFIG).canonicalFingerprint,
  );
});

test("members stay isolated and every artifact carries permanent synthetic provenance", () => {
  const dataset = runSimulationToCompletion({
    ...GOLDEN_SIMULATION_CONFIG,
    members: [{ personaId: "data-analyst", count: 2 }],
  });
  assert.equal(dataset.members.length, 2);
  assert.equal(new Set(dataset.members.map((member) => member.memberId)).size, 2);
  for (const group of Object.values(dataset.artifacts)) {
    for (const artifact of group) {
      assert.equal(artifact.stamp.isSynthetic, true);
      assert.equal(artifact.stamp.simulationRunId, dataset.runId);
      assert.ok(dataset.members.some((member) => member.memberId === artifact.stamp.memberId));
    }
  }
  for (const snapshot of dataset.weeklySnapshots) {
    assert.equal(snapshot.memberIds.length, 1);
  }
});

test("validator rejects real PII, arbitrary window titles, and filesystem paths", () => {
  const dataset = runSimulationToCompletion(GOLDEN_SIMULATION_CONFIG);
  const valid = validateSimulationDataset(dataset);
  assert.equal(valid.valid, true, valid.violations.map((item) => item.message).join("; "));

  const tampered = structuredClone(dataset);
  tampered.artifacts.rawEvents[0].payload.window_title = "Quarterly plan for person@example.com";
  tampered.artifacts.rawEvents[0].payload.file_path = "/Users/real/customer.csv";
  const invalid = validateSimulationDataset(tampered);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.violations.some((item) => item.code === "forbidden-pii"));
  assert.ok(invalid.violations.some((item) => item.code === "forbidden-path"));
});

test("simulator access denies signed-out and regular users, then allows a simulator admin", () => {
  assert.equal(authorizeSimulatorAccess({ authenticated: false, roles: [] }).allowed, false);
  assert.equal(authorizeSimulatorAccess({ authenticated: true, roles: ["member"] }).allowed, false);
  assert.equal(authorizeSimulatorAccess({ authenticated: true, roles: ["manager"] }).allowed, false);
  assert.equal(authorizeSimulatorAccess({ authenticated: true, roles: ["simulator_admin"] }).allowed, true);
});

test("local simulator authorization derives from the signed-in admin role without a feature flag", () => {
  assert.deepEqual(getLocalSimulatorAccessContext(false), {
    authenticated: false,
    roles: ["member"]
  });
  assert.deepEqual(getLocalSimulatorAccessContext(true), {
    authenticated: true,
    roles: ["simulator_admin"]
  });
});

test("local Manager Access accepts only its synthetic demo credentials without a feature flag", () => {
  assert.equal(
    authenticateLocalSimulatorAdmin(LOCAL_SIMULATOR_ADMIN_EMAIL, LOCAL_SIMULATOR_ADMIN_PASSWORD).allowed,
    true
  );
  assert.equal(authenticateLocalSimulatorAdmin(LOCAL_SIMULATOR_ADMIN_EMAIL, "wrong-password").allowed, false);
});

test("local Manager Access welcomes authorized users before presenting Span Simulator as a tool", () => {
  const signedOutView = getLocalAdminPortalView(false);
  assert.equal(signedOutView.heading, "Welcome to Manager Access");
  assert.deepEqual(signedOutView.tools, []);

  const signedInView = getLocalAdminPortalView(true);
  assert.equal(signedInView.heading, "Welcome to Manager Access");
  assert.deepEqual(signedInView.tools.map((tool) => tool.label), ["Span Simulator"]);
  assert.equal(signedInView.tools[0]?.href, "/admin/span-simulator");
});

test("exports preserve synthetic identity and spreadsheet-safe CSV", () => {
  const dataset = runSimulationToCompletion(GOLDEN_SIMULATION_CONFIG);
  const json = JSON.parse(serializeSimulationJson(dataset));
  assert.equal(json.isSynthetic, true);
  assert.equal(json.canonicalFingerprint, dataset.canonicalFingerprint);

  const csv = serializeWeeklySnapshotsCsv(dataset);
  assert.match(csv.split("\n")[0], /is_synthetic,simulation_run_id/);
  assert.doesNotMatch(csv, /person@example\.com|\/Users\//);
});

test("local playback is restricted to Weekform-owned localhost sandbox pages", () => {
  assert.equal(isAllowedPlaybackUrl("http://127.0.0.1:5173/simulator-sandbox/bi"), true);
  assert.equal(isAllowedPlaybackUrl("http://localhost:5173/simulator-sandbox/chat"), true);
  assert.equal(isAllowedPlaybackUrl("https://example.com/simulator-sandbox/chat"), false);
  assert.equal(isAllowedPlaybackUrl("http://127.0.0.1:5173/"), false);
  assert.equal(isAllowedPlaybackUrl("http://127.0.0.1:5173/simulator-sandbox/arbitrary"), false);
  assert.equal(isAllowedPlaybackUrl("file:///tmp/demo.html"), false);

  const plan = buildLocalPlaybackPlan(GOLDEN_SIMULATION_CONFIG);
  assert.ok(plan.actions.length > 0);
  assert.ok(plan.actions.every((action) => isAllowedPlaybackUrl(action.url)));
  assert.ok(plan.actions.every((action) => ["navigate", "click", "type", "switch-tab", "wait"].includes(action.type)));
  assert.equal(plan.syntheticCredentialsOnly, true);
  assert.equal(plan.externalMutationsAllowed, false);
});
