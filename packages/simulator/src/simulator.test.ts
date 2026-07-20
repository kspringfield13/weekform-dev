import test from "node:test";
import assert from "node:assert/strict";

import { PERSONA_CATALOG, getPersona } from "./personas";
import { PERSONA_WORK_CATALOGS, getPersonaWorkCatalog } from "./workCatalog";
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
import { applyScenarioPreset, getScenarioPreset } from "./presets";

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

test("every persona has a role-specific catalog of duties, communications, and business measures", () => {
  assert.equal(PERSONA_WORK_CATALOGS.length, PERSONA_CATALOG.length);
  for (const persona of PERSONA_CATALOG) {
    const catalog = getPersonaWorkCatalog(persona.id);
    assert.ok(catalog, `${persona.id} is missing its work catalog`);
    assert.ok(catalog.duties.length >= 4, `${persona.id} needs at least four realistic duties`);
    assert.ok(catalog.communicationPatterns.length >= 3, `${persona.id} needs communication patterns`);
    assert.ok(catalog.businessMeasures.length >= 3, `${persona.id} needs business measures`);
    assert.equal(new Set(catalog.duties.map((duty) => duty.id)).size, catalog.duties.length);
    assert.ok(catalog.duties.every((duty) => duty.title.length >= 12 && duty.deliverable.length >= 12));
  }
});

test("golden configuration is a valid 26-week New York simulation", () => {
  const validation = validateSimulationConfig(GOLDEN_SIMULATION_CONFIG);
  assert.equal(validation.valid, true, validation.errors.join("; "));
  assert.equal(GOLDEN_SIMULATION_CONFIG.span.value, 26);
  assert.equal(GOLDEN_SIMULATION_CONFIG.span.unit, "weeks");
  assert.equal(GOLDEN_SIMULATION_CONFIG.timezone, "America/New_York");
  assert.equal(GOLDEN_SIMULATION_CONFIG.seed, "20260718");
});

test("scenario presets update every correlated pressure control instead of changing only the label", () => {
  const quiet = applyScenarioPreset(GOLDEN_SIMULATION_CONFIG, "quiet");
  const incident = applyScenarioPreset(GOLDEN_SIMULATION_CONFIG, "incident");

  assert.equal(quiet.scenario.kind, "quiet");
  assert.equal(quiet.scenario.title, getScenarioPreset("quiet").title);
  assert.ok(quiet.scenario.reactiveLoad < incident.scenario.reactiveLoad);
  assert.ok(quiet.scenario.interruptions < incident.scenario.interruptions);
  assert.ok(quiet.scenario.fragmentation < incident.scenario.fragmentation);
  assert.ok(quiet.scenario.projectCount < incident.scenario.projectCount);
  assert.deepEqual(GOLDEN_SIMULATION_CONFIG.scenario.kind, "quarter-end");
  assert.equal(validateSimulationConfig(quiet).valid, true);
  assert.equal(validateSimulationConfig(incident).valid, true);
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

test("long spans produce correlated role duties, communication, and plausible business data", () => {
  const dataset = runSimulationToCompletion(GOLDEN_SIMULATION_CONFIG);
  const workItems = dataset.artifacts.workItems;
  const communications = dataset.artifacts.communications;
  const businessRecords = dataset.artifacts.businessRecords;

  assert.ok(workItems.length >= 26 * 3, "expected at least three concrete duties per week");
  assert.ok(communications.length >= 26 * 3, "expected recurring communication throughout the span");
  assert.ok(businessRecords.length >= 26 * 3, "expected business measures throughout the span");
  assert.equal(new Set(workItems.map((item) => item.payload.weekId)).size, 26);
  assert.equal(new Set(communications.map((item) => item.payload.weekId)).size, 26);
  assert.equal(new Set(businessRecords.map((item) => item.payload.weekId)).size, 26);
  assert.ok(workItems.some((item) => item.payload.status === "completed"));
  assert.ok(workItems.some((item) => item.payload.status === "blocked" || item.payload.status === "in-progress"));
  assert.ok(workItems.every((item) => item.payload.title.startsWith("SIMULATED —")));
  assert.ok(communications.every((item) => item.payload.subject.startsWith("SIMULATED —")));
  assert.ok(businessRecords.every((item) => Number.isFinite(item.payload.value) && Number.isFinite(item.payload.target)));
  assert.ok(businessRecords.every((item) => item.payload.value >= item.payload.plausibleMin && item.payload.value <= item.payload.plausibleMax));

  const workItemIds = new Set(workItems.map((item) => item.payload.workItemId));
  assert.ok(communications.every((item) => workItemIds.has(item.payload.relatedWorkItemId)));
  assert.ok(businessRecords.every((item) => workItemIds.has(item.payload.relatedWorkItemId)));
});

test("role duties are the traceable source of synthetic evidence and inferred work blocks", () => {
  const dataset = runSimulationToCompletion({
    ...GOLDEN_SIMULATION_CONFIG,
    span: { value: 2, unit: "weeks" },
    scenario: { ...GOLDEN_SIMULATION_CONFIG.scenario, kind: "normal" },
  });
  const workItems = new Map(dataset.artifacts.workItems.map((artifact) => [artifact.payload.workItemId, artifact.payload]));
  const blocksByEventId = new Map(
    dataset.artifacts.workBlocks.flatMap((artifact) => artifact.payload.derived_from.map((eventId) => [eventId, artifact.payload] as const)),
  );
  const foregroundEvents = dataset.artifacts.rawEvents.filter((artifact) => artifact.payload.source_type === "window");

  assert.ok(foregroundEvents.length > 0);
  for (const artifact of foregroundEvents) {
    const event = artifact.payload;
    const workItemId = event.metadata.work_item_id;
    assert.ok(workItemId, `raw event ${event.event_id} is missing work_item_id metadata`);
    const workItem = workItems.get(workItemId);
    assert.ok(workItem, `raw event ${event.event_id} references an unknown work item`);
    assert.equal(event.project_hint, workItem.project);
    assert.match(event.window_title ?? "", new RegExp(workItem.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    const block = blocksByEventId.get(event.event_id);
    assert.ok(block, `raw event ${event.event_id} did not reach the real WorkBlock importer`);
    assert.equal(block.project_name, workItem.project);
    assert.equal(block.category, workItem.category);
    assert.equal(block.mode, workItem.mode);
    assert.ok(block.evidence.includes(`Work item: ${workItemId}`));
  }
});

test("scenario controls and persona rhythms materially change deterministic scheduling", () => {
  const lowPressure = runSimulationToCompletion({
    ...GOLDEN_SIMULATION_CONFIG,
    span: { value: 8, unit: "weeks" },
    scenario: {
      ...GOLDEN_SIMULATION_CONFIG.scenario,
      kind: "normal",
      reactiveLoad: 0,
      interruptions: 0,
      fragmentation: 0,
      projectCount: 1,
    },
  });
  const highPressure = runSimulationToCompletion({
    ...GOLDEN_SIMULATION_CONFIG,
    span: { value: 8, unit: "weeks" },
    scenario: {
      ...GOLDEN_SIMULATION_CONFIG.scenario,
      kind: "normal",
      reactiveLoad: 100,
      interruptions: 100,
      fragmentation: 100,
      projectCount: 4,
    },
  });
  const totalMinutes = (dataset: typeof lowPressure, mode: string) => dataset.artifacts.workBlocks
    .filter((artifact) => artifact.payload.mode === mode)
    .reduce((total, artifact) => total + (new Date(artifact.payload.end_time).getTime() - new Date(artifact.payload.start_time).getTime()) / 60_000, 0);

  assert.equal(new Set(lowPressure.artifacts.workItems.map((artifact) => artifact.payload.project)).size, 1);
  assert.equal(new Set(highPressure.artifacts.workItems.map((artifact) => artifact.payload.project)).size, 4);
  assert.ok(totalMinutes(highPressure, "Reactive") > totalMinutes(lowPressure, "Reactive"));
  assert.ok(totalMinutes(highPressure, "Fragmented") > totalMinutes(lowPressure, "Fragmented"));

  const dataAnalyst = runSimulationToCompletion({
    ...GOLDEN_SIMULATION_CONFIG,
    span: { value: 26, unit: "weeks" },
    scenario: { ...GOLDEN_SIMULATION_CONFIG.scenario, kind: "normal" },
  });
  const operationsManager = runSimulationToCompletion({
    ...GOLDEN_SIMULATION_CONFIG,
    members: [{ personaId: "operations-manager", count: 1 }],
    span: { value: 26, unit: "weeks" },
    scenario: { ...GOLDEN_SIMULATION_CONFIG.scenario, kind: "normal" },
  });
  const reactiveDutyCount = (dataset: typeof dataAnalyst) => dataset.artifacts.workItems
    .filter((artifact) => artifact.payload.mode === "Reactive").length;
  assert.ok(reactiveDutyCount(operationsManager) > reactiveDutyCount(dataAnalyst));

  const calendarMinutes = (dataset: typeof dataAnalyst) => dataset.artifacts.calendarEvents.reduce(
    (total, artifact) => total + (new Date(artifact.payload.end_time).getTime() - new Date(artifact.payload.start_time).getTime()) / 60_000,
    0,
  );
  assert.ok(calendarMinutes(operationsManager) > calendarMinutes(dataAnalyst));
});

test("role artifacts honor availability and working hours, with incident blocking limited to spike weeks", () => {
  const bounded = runSimulationToCompletion({
    ...GOLDEN_SIMULATION_CONFIG,
    startDate: "2026-01-05",
    span: { value: 2, unit: "weeks" },
    workDays: [2, 4],
    workingHours: { start: "10:00", end: "14:00" },
    holidays: ["2026-01-06"],
    pto: [{ startDate: "2026-01-08", endDateExclusive: "2026-01-09" }],
    scenario: { ...GOLDEN_SIMULATION_CONFIG.scenario, kind: "normal" },
  });
  const firstWeekId = "2026-W02";
  assert.equal(bounded.artifacts.workItems.filter((artifact) => artifact.payload.weekId === firstWeekId).length, 0);
  for (const artifact of [
    ...bounded.artifacts.workItems.map((entry) => ({ at: entry.payload.dueAt, scheduledDate: entry.payload.scheduledDate })),
    ...bounded.artifacts.communications.map((entry) => ({ at: entry.payload.occurredAt, scheduledDate: entry.payload.occurredAt.slice(0, 10) })),
    ...bounded.artifacts.businessRecords.map((entry) => ({ at: entry.payload.recordedAt, scheduledDate: entry.payload.recordedAt.slice(0, 10) })),
  ]) {
    assert.ok([2, 4].includes(new Date(`${artifact.scheduledDate}T00:00:00Z`).getUTCDay()));
    const localHour = Number(new Intl.DateTimeFormat("en-US", {
      timeZone: bounded.config.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(artifact.at)).split(":")[0]);
    assert.ok(localHour >= 10 && localHour <= 14);
  }

  const incident = runSimulationToCompletion({
    ...GOLDEN_SIMULATION_CONFIG,
    span: { value: 10, unit: "weeks" },
    scenario: { ...GOLDEN_SIMULATION_CONFIG.scenario, kind: "incident" },
  });
  const blockedWeekIds = new Set(
    incident.artifacts.workItems.filter((artifact) => artifact.payload.status === "blocked").map((artifact) => artifact.payload.weekId),
  );
  assert.deepEqual([...blockedWeekIds], ["2026-W06"]);
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
    members: [{ personaId: "data-analyst", count: 1 }, { personaId: "software-engineer", count: 1 }],
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
  for (const member of dataset.members) {
    const catalog = getPersonaWorkCatalog(member.personaId)!;
    const allowedTitles = new Set(catalog.duties.map((duty) => `SIMULATED — ${duty.title}`));
    const memberWork = dataset.artifacts.workItems.filter((item) => item.stamp.memberId === member.memberId);
    assert.ok(memberWork.length > 0);
    assert.ok(memberWork.every((item) => allowedTitles.has(item.payload.title)));
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

test("validator rejects broken work-world links and implausible business measures", () => {
  const dataset = runSimulationToCompletion(GOLDEN_SIMULATION_CONFIG);
  const tampered = structuredClone(dataset);
  tampered.artifacts.communications[0].payload.relatedWorkItemId = "missing-work-item";
  tampered.artifacts.businessRecords[0].payload.value = tampered.artifacts.businessRecords[0].payload.plausibleMax + 1;

  const invalid = validateSimulationDataset(tampered);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.violations.some((item) => item.code === "broken-work-link"));
  assert.ok(invalid.violations.some((item) => item.code === "implausible-business-value"));
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

test("local Manager Access welcomes authorized users before presenting Simulation as a tool", () => {
  const signedOutView = getLocalAdminPortalView(false);
  assert.equal(signedOutView.heading, "Welcome to Manager Access");
  assert.deepEqual(signedOutView.tools, []);

  const signedInView = getLocalAdminPortalView(true);
  assert.equal(signedInView.heading, "Welcome to Manager Access");
  assert.deepEqual(signedInView.tools.map((tool) => tool.label), ["Simulation"]);
  assert.equal(signedInView.tools[0]?.href, "/manager-access/simulation");
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

test("live simulation is restricted to Weekform-owned localhost surfaces", () => {
  assert.equal(isAllowedPlaybackUrl("http://127.0.0.1:5173/simulator-sandbox/bi"), true);
  assert.equal(isAllowedPlaybackUrl("http://localhost:5173/simulator-sandbox/chat?persona=data-analyst"), true);
  assert.equal(isAllowedPlaybackUrl("http://127.0.0.1:5173/?demo=1&simulator=1&screen=daily&simulationPersona=data-analyst"), true);
  assert.equal(isAllowedPlaybackUrl("https://example.com/simulator-sandbox/chat"), false);
  assert.equal(isAllowedPlaybackUrl("http://127.0.0.1:5173/"), false);
  assert.equal(isAllowedPlaybackUrl("http://127.0.0.1:5173/?demo=1&screen=daily"), false);
  assert.equal(isAllowedPlaybackUrl("http://127.0.0.1:5173/?demo=1&simulator=1&screen=setup&simulationPersona=data-analyst"), false);
  assert.equal(isAllowedPlaybackUrl("http://127.0.0.1:5173/?demo=1&simulator=1&screen=daily&simulationPersona=unknown"), false);
  assert.equal(isAllowedPlaybackUrl("http://127.0.0.1:5173/simulator-sandbox/arbitrary"), false);
  assert.equal(isAllowedPlaybackUrl("file:///tmp/demo.html"), false);

  const plan = buildLocalPlaybackPlan(GOLDEN_SIMULATION_CONFIG);
  assert.ok(plan.actions.length >= 8);
  assert.ok(plan.actions.every((action) => isAllowedPlaybackUrl(action.url)));
  assert.ok(plan.actions.every((action) => ["navigate", "click", "type", "switch-tab", "wait"].includes(action.type)));
  assert.ok(plan.actions.every((action) => action.personaId === "data-analyst"));
  assert.ok(plan.actions.every((action) => action.label.length > 0 && action.detail.length > 0));
  assert.ok(plan.actions.some((action) => action.surface === "business-app"));
  assert.ok(plan.actions.some((action) => action.surface === "weekform" && action.selector === ".block-confirm"));
  assert.ok(plan.actions.some((action) => action.surface === "weekform" && action.selector === "[data-tour='week']"));
  assert.equal(plan.syntheticCredentialsOnly, true);
  assert.equal(plan.externalMutationsAllowed, false);
  assert.equal(plan.embeddedSameOriginOnly, true);
  assert.equal(plan.dedicatedProfile, false);

  const localhostPlan = buildLocalPlaybackPlan(GOLDEN_SIMULATION_CONFIG, "http://localhost:5173");
  assert.ok(localhostPlan.actions.every((action) => new URL(action.url).hostname === "localhost"));
  const multiPersonaPlan = buildLocalPlaybackPlan({
    ...GOLDEN_SIMULATION_CONFIG,
    members: [{ personaId: "data-analyst", count: 1 }, { personaId: "software-engineer", count: 1 }],
  });
  assert.deepEqual(new Set(multiPersonaPlan.actions.map((action) => action.personaId)), new Set(["data-analyst", "software-engineer"]));
  assert.equal(multiPersonaPlan.actions.length, plan.actions.length * 2);
  assert.throws(
    () => buildLocalPlaybackPlan(GOLDEN_SIMULATION_CONFIG, "https://127.0.0.1:5173"),
    /exact local Weekform development origin/,
  );
});
