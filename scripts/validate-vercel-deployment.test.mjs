import assert from "node:assert/strict";
import test from "node:test";

import {
  parseCandidateDeployment,
  parseExpectedCurrentProduction,
  parseInspectedCandidate,
  parsePreviousProduction,
} from "./validate-vercel-deployment.mjs";

const candidate = {
  id: "dpl_Candidate123",
  url: "https://weekform-build-123-blerbz.vercel.app",
  readyState: "READY",
  target: "production",
};

test("candidate deploy parser accepts direct and agent-wrapped READY production metadata", () => {
  assert.deepEqual(parseCandidateDeployment(JSON.stringify(candidate)), candidate);
  assert.deepEqual(
    parseCandidateDeployment(JSON.stringify({ status: "ok", deployment: candidate })),
    candidate,
  );
});

test("candidate deploy parser fails closed on malformed, non-ready, or unsafe metadata", () => {
  for (const value of [
    "not-json",
    JSON.stringify({ ...candidate, readyState: "BUILDING" }),
    JSON.stringify({ ...candidate, target: "preview" }),
    JSON.stringify({ ...candidate, id: "candidate" }),
    JSON.stringify({ ...candidate, url: "http://weekform-build.vercel.app" }),
    JSON.stringify({ ...candidate, url: "https://weekform.dev" }),
    JSON.stringify({ ...candidate, url: "https://weekform-build.vercel.app/path?token=secret" }),
    JSON.stringify({ ...candidate, error: { message: "provider error" } }),
    JSON.stringify({ status: "error", deployment: candidate }),
    JSON.stringify({ status: "ok", deployment: { ...candidate, error: "failed" } }),
  ]) {
    assert.throws(() => parseCandidateDeployment(value), /candidate deployment metadata was invalid/i);
  }
});

test("candidate inspection binds project, deployment identity, URL, target, and unpromoted aliases", () => {
  const inspected = {
    id: candidate.id,
    name: "weekform",
    url: "weekform-build-123-blerbz.vercel.app",
    target: "production",
    readyState: "READY",
  };
  assert.deepEqual(
    parseInspectedCandidate(JSON.stringify(inspected), {
      expectedId: candidate.id,
      expectedUrl: candidate.url,
    }),
    { ...inspected, aliases: [], url: candidate.url },
  );

  const currentCliShape = {
    ...inspected,
    aliases: [
      "weekform-blerbz.vercel.app",
      "weekform-blerbz-blerbz.vercel.app",
    ],
  };
  assert.deepEqual(
    parseInspectedCandidate(JSON.stringify(currentCliShape), {
      expectedId: candidate.id,
      expectedUrl: candidate.url,
    }),
    { ...currentCliShape, url: candidate.url },
  );

  for (const changed of [
    { ...inspected, id: "dpl_Other123" },
    { ...inspected, name: "other" },
    { ...inspected, aliases: ["weekform.dev"] },
    { ...inspected, aliases: ["other-project.vercel.app"] },
    { ...inspected, aliases: ["weekform-blerbz.vercel.app", "hostile.example"] },
    { ...inspected, url: "different-build.vercel.app" },
  ]) {
    assert.throws(
      () =>
        parseInspectedCandidate(JSON.stringify(changed), {
          expectedId: candidate.id,
          expectedUrl: candidate.url,
        }),
      /candidate deployment metadata was invalid/i,
    );
  }
});

test("previous production parser requires the exact canonical alias and Weekform project", () => {
  const inspected = {
    id: "dpl_Previous123",
    name: "weekform",
    url: "weekform-previous-blerbz.vercel.app",
    target: "production",
    readyState: "READY",
    aliases: ["weekform.dev", "www.weekform.dev"],
  };
  assert.deepEqual(parsePreviousProduction(JSON.stringify(inspected)), {
    ...inspected,
    url: `https://${inspected.url}`,
  });

  const currentCliShape = {
    ...inspected,
    aliases: [
      "weekform-blerbz.vercel.app",
      "weekform-blerbz-blerbz.vercel.app",
    ],
  };
  assert.deepEqual(parsePreviousProduction(JSON.stringify(currentCliShape)), {
    ...currentCliShape,
    url: `https://${currentCliShape.url}`,
  });

  for (const changed of [
    { ...inspected, name: "other" },
    { ...inspected, aliases: ["www.weekform.dev"] },
    { ...inspected, aliases: [] },
    { ...inspected, aliases: ["other-project.vercel.app"] },
    { ...inspected, aliases: ["weekform-blerbz.vercel.app", "hostile.example"] },
    { ...inspected, target: null },
  ]) {
    assert.throws(
      () => parsePreviousProduction(JSON.stringify(changed)),
      /production deployment metadata was invalid/i,
    );
  }
});

test("current production parser rejects a deployment that drifted after rollback capture", () => {
  const inspected = {
    id: "dpl_Previous123",
    name: "weekform",
    url: "weekform-previous-blerbz.vercel.app",
    target: "production",
    readyState: "READY",
    aliases: ["weekform.dev"],
  };
  assert.equal(
    parseExpectedCurrentProduction(JSON.stringify(inspected), "dpl_Previous123").id,
    "dpl_Previous123",
  );
  assert.throws(
    () => parseExpectedCurrentProduction(JSON.stringify(inspected), "dpl_Concurrent456"),
    /production deployment metadata was invalid/i,
  );

  const promotedCandidate = {
    ...inspected,
    id: "dpl_Candidate123",
    url: "weekform-candidate-blerbz.vercel.app",
  };
  assert.equal(
    parseExpectedCurrentProduction(JSON.stringify(promotedCandidate), "dpl_Candidate123").id,
    "dpl_Candidate123",
  );
  assert.throws(
    () => parseExpectedCurrentProduction(JSON.stringify(promotedCandidate), "dpl_Concurrent456"),
    /production deployment metadata was invalid/i,
  );
});
