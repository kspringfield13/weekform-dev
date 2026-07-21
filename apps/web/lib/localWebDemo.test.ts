import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { parsePersonalReplicaRow } from "./personalReplica";
import {
  createLocalWebDemoData,
  localWebDemoEnabled,
  localWebDemoRequestEnabled,
} from "./localWebDemo";

const REFERENCE = new Date("2026-07-21T15:45:00.000Z");

test("the local Web demo is explicit, development-only, and loopback-only", () => {
  assert.equal(localWebDemoEnabled({
    enabled: "1",
    host: "localhost:3000",
    nodeEnv: "development",
  }), true);
  assert.equal(localWebDemoEnabled({
    enabled: "1",
    host: "127.0.0.1:3000",
    nodeEnv: "development",
  }), true);

  for (const candidate of [
    { enabled: undefined, host: "localhost:3000", nodeEnv: "development" },
    { enabled: "0", host: "localhost:3000", nodeEnv: "development" },
    { enabled: "1", host: "localhost:3000", nodeEnv: "production" },
    { enabled: "1", host: "weekform.dev", nodeEnv: "development" },
    { enabled: "1", host: "localhost.evil.test", nodeEnv: "development" },
    { enabled: "1", host: "127.0.0.1.evil.test", nodeEnv: "development" },
    { enabled: "1", host: "localhost:0", nodeEnv: "development" },
    { enabled: "1", host: "localhost:65536", nodeEnv: "development" },
  ]) {
    assert.equal(localWebDemoEnabled(candidate), false, JSON.stringify(candidate));
  }

  assert.equal(localWebDemoRequestEnabled({
    enabled: "1",
    host: "127.0.0.1:3000",
    nodeEnv: "development",
    pathname: "/demo",
  }), true);
  assert.equal(localWebDemoRequestEnabled({
    enabled: "1",
    host: "localhost:3000",
    nodeEnv: "development",
    pathname: "/demo/team",
  }), true);
  for (const pathname of ["/app", "/teams/local-demo-team", "/demo/other", "/demo/team/member"]) {
    assert.equal(localWebDemoRequestEnabled({
      enabled: "1",
      host: "localhost:3000",
      nodeEnv: "development",
      pathname,
    }), false);
  }
});

test("the local Web demo carries valid multiweek personal data without source identity in the replica", () => {
  const demo = createLocalWebDemoData(REFERENCE);

  assert.ok(demo.personalReplicas.length >= 5);
  for (const replica of demo.personalReplicas) {
    assert.deepEqual(parsePersonalReplicaRow({
      replica_id: replica.replicaId,
      week_id: replica.weekId,
      revision: replica.revision,
      synced_at: replica.syncedAt,
      payload: replica.payload,
    }), replica);
  }

  const publishedReplicaJson = JSON.stringify(demo.personalReplicas);
  assert.doesNotMatch(
    publishedReplicaJson,
    /Slack|Apple Calendar|provider|conversation|message body|event title|attendee/i,
  );
  assert.equal(demo.sources.calendar.name, "Apple Calendar");
  assert.equal(demo.sources.chat.name, "Slack");
  assert.equal(demo.sources.calendar.synthetic, true);
  assert.equal(demo.sources.chat.synthetic, true);
  assert.ok(demo.sources.calendar.eventCount > 0);
  assert.ok(demo.sources.chat.episodeCount > 0);
  assert.ok(demo.sources.chat.directedCount > 0);
});

test("the Team demo fills current and historical calendar analytics through real evidence derivation", () => {
  const demo = createLocalWebDemoData(REFERENCE);
  const weeks = new Set(demo.team.history.map((snapshot) => snapshot.weekId));
  const members = new Set(demo.team.history.map((snapshot) => snapshot.userId));

  assert.equal(weeks.size, 13);
  assert.equal(members.size, demo.team.identities.length);
  assert.equal(demo.team.identities.length, 5);
  assert.ok(demo.team.evidence.length >= 25);
  assert.equal(demo.team.forecast.verdict, "forecast");
  assert.ok(demo.team.forecast.metrics.reliableCapacityPct.forecast);
  assert.ok(demo.team.evidence.some((day) => day.calendarEventCount > 0));
  assert.ok(demo.team.evidence.some((day) => day.chatEpisodeCount > 0));
  assert.ok(demo.team.evidence.some((day) => day.reviewedBlockCount > 0));
  assert.deepEqual(
    new Set(demo.team.evidence.map((day) => day.insight).filter(Boolean)),
    new Set(["blended-pressure", "meeting-dense", "communication-burst"]),
  );
});

test("today never invents future observed Slack or reviewed-work facts", () => {
  const early = createLocalWebDemoData(new Date("2026-07-21T06:00:00.000Z"));
  const today = early.team.evidence.find((day) => day.dateId === "2026-07-21");

  assert.ok(today, "scheduled Apple Calendar context can still establish today");
  assert.ok(today.calendarEventCount > 0);
  assert.equal(today.chatEpisodeCount, 0);
  assert.equal(today.directedChatCount, 0);
  assert.equal(today.reviewedBlockCount, 0);
});

test("the reduced Team evidence is provider-free, allowlisted, and reconciles to source totals", () => {
  const demo = createLocalWebDemoData(REFERENCE);
  const allowedEvidenceKeys = [
    "calendarEventCount",
    "calendarMinutes",
    "chatEpisodeCount",
    "dateId",
    "directedChatCount",
    "insight",
    "reviewedBlockCount",
  ];

  for (const day of demo.team.evidence) {
    assert.deepEqual(Object.keys(day).sort(), allowedEvidenceKeys);
  }
  assert.doesNotMatch(
    JSON.stringify(demo.team.evidence),
    /provider|source|metadata|title|attendee|conversation|message|person/i,
  );
  assert.equal(
    demo.sources.calendar.eventCount,
    demo.team.evidence.reduce((total, day) => total + day.calendarEventCount, 0),
  );
  assert.equal(
    demo.sources.calendar.minutes,
    demo.team.evidence.reduce((total, day) => total + day.calendarMinutes, 0),
  );
  assert.equal(
    demo.sources.chat.episodeCount,
    demo.team.evidence.reduce((total, day) => total + day.chatEpisodeCount, 0),
  );
  assert.equal(
    demo.sources.chat.directedCount,
    demo.team.evidence.reduce((total, day) => total + day.directedChatCount, 0),
  );
  assert.equal(
    demo.team.forecast.sharedCount,
    demo.team.latest.filter((snapshot) => snapshot.reliableCapacityPct !== null).length,
  );
});

test("the local Web demo exposes every workspace page without adding an auth bypass or mutation surface", () => {
  const individualPage = readFileSync(
    new URL("../app/demo/page.tsx", import.meta.url),
    "utf8",
  );
  const teamPage = readFileSync(
    new URL("../app/demo/team/page.tsx", import.meta.url),
    "utf8",
  );
  const individualDemo = readFileSync(
    new URL("../components/LocalWebIndividualDemo.tsx", import.meta.url),
    "utf8",
  );
  const teamDemo = readFileSync(
    new URL("../components/LocalWebTeamDemo.tsx", import.meta.url),
    "utf8",
  );
  const middleware = readFileSync(
    new URL("supabase/middleware.ts", import.meta.url),
    "utf8",
  );
  const webPackage = readFileSync(new URL("../package.json", import.meta.url), "utf8");

  assert.match(individualPage, /localWebDemoEnabled/);
  assert.match(teamPage, /localWebDemoEnabled/);
  assert.match(individualPage, /notFound\(\)/);
  assert.match(teamPage, /notFound\(\)/);
  assert.match(webPackage, /next dev --hostname 127\.0\.0\.1/);
  assert.match(middleware, /localWebDemoRequestEnabled/);
  assert.match(middleware, /WEEKFORM_WEB_LOCAL_DEMO/);
  assert.match(middleware, /!isProtectedWebPath\(request\.nextUrl\.pathname\)/);
  assert.match(individualDemo, /demoReadOnly/);
  assert.doesNotMatch(individualDemo, /action=|<form|createClient|supabase/i);
  assert.doesNotMatch(teamDemo, /action=|<form|createClient|supabase/i);

  for (const view of ["today", "week", "agent", "history", "settings"]) {
    assert.match(individualDemo, new RegExp(`data-web-view=["']${view}["']`));
    assert.match(teamDemo, new RegExp(`data-web-view=["']${view}["']`));
  }
  assert.match(teamDemo, /evidence=\{demo\.team\.evidence\}/);
  assert.match(teamDemo, /Apple Calendar/);
  assert.match(teamDemo, /Slack/);
});
