import assert from "node:assert/strict";
import test from "node:test";

import { formatEvidenceCount } from "./teamGanttEvidencePresentation";

test("Team Calendar evidence counts use readable singular and plural labels", () => {
  assert.equal(formatEvidenceCount(0, "event"), "0 events");
  assert.equal(formatEvidenceCount(1, "event"), "1 event");
  assert.equal(formatEvidenceCount(2, "event"), "2 events");
  assert.equal(formatEvidenceCount(1, "person", "people"), "1 person");
  assert.equal(formatEvidenceCount(3, "person", "people"), "3 people");
});
