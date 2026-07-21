import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const calendarSource = readFileSync(
  new URL("../components/settings/CalendarSourcesPanel.tsx", import.meta.url),
  "utf8",
);
const chatSource = readFileSync(
  new URL("../components/settings/ChatSourcesPanel.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("calendar and chat ranges expose distinct programmatic group names", () => {
  assert.match(
    calendarSource,
    /className="calendar-range"\s+role="group"\s+aria-label="Calendar date range"/,
  );
  assert.match(
    chatSource,
    /className="calendar-range"\s+role="group"\s+aria-label="Chat transfer date range"/,
  );
});

test("settings date ranges fit a 390px browser demo without horizontal page scrolling", () => {
  const narrowRangeContract = styles.slice(styles.indexOf("/* Narrow Settings date-range contract */"));

  assert.match(narrowRangeContract, /@media \(max-width: 420px\)/);
  assert.match(narrowRangeContract, /\.calendar-range\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
  assert.match(narrowRangeContract, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto\s+minmax\(0,\s*1fr\)/);
  assert.match(narrowRangeContract, /\.calendar-range input\s*\{[\s\S]*?min-width:\s*0[\s\S]*?width:\s*100%/);
  assert.match(narrowRangeContract, /\.calendar-range\s*>\s*\.icon-button\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1/);
});
