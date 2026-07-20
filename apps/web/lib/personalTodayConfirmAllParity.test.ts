import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const todaySource = readFileSync(new URL("../components/PersonalTodayScreen.tsx", import.meta.url), "utf8");
const actionsSource = readFileSync(new URL("../app/dashboard/personalActions.ts", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const migrationUrl = new URL("../../../supabase/migrations/202607200005_review_command_two_phase.sql", import.meta.url);
const migrationSource = existsSync(migrationUrl) ? readFileSync(migrationUrl, "utf8") : "";

test("Web Today exposes Desktop's primary confirm-all header action with the eligible count", () => {
  assert.match(todaySource, /eligibleReviewConfirmTargets/);
  assert.match(todaySource, /review-header-actions/);
  assert.match(stylesSource, /\.review-header-actions\b/);
  assert.match(todaySource, /queuePersonalReviewConfirmBatch/);
  assert.match(todaySource, /name=["']targets["']/);
  assert.match(todaySource, /JSON\.stringify\([^)]*(?:eligible|confirm)[^)]*\)/i);
  assert.match(todaySource, /Confirm all\s*\{[^}]*\.length\}/);
  assert.match(todaySource, /pendingLabel=["']Sending requests…["']/);
  assert.doesNotMatch(todaySource, /localStorage|sessionStorage|indexedDB/i);
});

test("Web Today omits the bulk action when no review-safe target is eligible", () => {
  assert.match(todaySource, /(?:eligible|confirm)\w*\.length\s*>\s*0/i);
  assert.match(todaySource, /Approval required on Mac/);
});

test("Web Today names a capped batch as the next fifty and discloses total and remaining work", () => {
  assert.match(todaySource, /reviewConfirmEligibility/);
  assert.match(todaySource, /remainingConfirmCount\s*=\s*totalEligibleConfirmCount\s*-\s*eligibleConfirmTargets\.length/);
  assert.match(todaySource, /remainingConfirmCount\s*>\s*0/);
  assert.match(todaySource, /["']Confirm next 50["']/);
  assert.match(todaySource, /Confirm all\s*\{eligibleConfirmTargets\.length\}/);
  assert.match(todaySource, /50\s*of\s*\{totalEligibleConfirmCount\}/);
  assert.match(todaySource, /\{remainingConfirmCount\}\s*will remain/i);
});

test("confirm-all server action validates first and calls only the transactional RPC", () => {
  assert.match(actionsSource, /export async function queuePersonalReviewConfirmBatch/);
  assert.match(actionsSource, /reviewConfirmBatchInput/);
  assert.match(actionsSource, /text\(formData,\s*["']targets["']\)/);
  assert.match(actionsSource, /JSON\.parse/);
  assert.match(actionsSource, /rpc\(["']queue_review_confirm_batch_compatible["']/);
  assert.doesNotMatch(actionsSource, /queuePersonalReviewConfirmBatch[\s\S]*?\.from\(["']review_commands["']\)[\s\S]*?\.insert\(/);
  assert.match(actionsSource, /No review requests were queued/i);
  assert.match(actionsSource, /requests? sent to your Mac/i);
});

test("v2 batch RPC derives confirmation behavior and owns identity and lifecycle fields", () => {
  assert.match(migrationSource, /create or replace function public\.queue_review_confirm_batch_v2\(\s*p_targets jsonb/);
  assert.match(migrationSource, /actor uuid := auth\.uid\(\)/);
  assert.match(migrationSource, /jsonb_typeof\(p_targets\)\s*(?:<>|!=)\s*'array'/);
  assert.match(migrationSource, /jsonb_array_length\(p_targets\)[\s\S]*between 1 and 50/);
  assert.match(migrationSource, /jsonb_object_keys/);
  assert.match(migrationSource, /blockId/);
  assert.match(migrationSource, /weekId/);
  assert.match(migrationSource, /expectedRevision/);
  assert.match(migrationSource, /select count\([^)]*\)\s*(?:<>|!=)\s*jsonb_array_length\(p_targets\)[\s\S]*personal_workload_replicas/);
  assert.match(migrationSource, /personal_workload_replicas[\s\S]*blockId[\s\S]*expectedRevision[\s\S]*userVerified/);
  assert.match(migrationSource, /if replica_conflict[\s\S]*replica revision conflict/);
  assert.match(migrationSource, /userVerified/);
  assert.match(migrationSource, /for update/);
  assert.match(migrationSource, /insert into public\.review_commands_v2\s*\([\s\S]*user_id[\s\S]*action[\s\S]*patch[\s\S]*created_by/);
  assert.match(migrationSource, /values\s*\([\s\S]*actor[\s\S]*'confirm'[\s\S]*null[\s\S]*actor/);
  assert.match(migrationSource, /on conflict[\s\S]*do nothing/);
  assert.match(migrationSource, /another review request is already pending/i);
});

test("compatible batch routing is security-definer and authenticated-only", () => {
  assert.match(migrationSource, /create or replace function public\.queue_review_confirm_batch_compatible/);
  assert.match(migrationSource, /return public\.queue_review_confirm_batch_v2/);
  assert.match(migrationSource, /return public\.queue_review_confirm_batch\(/);
  assert.match(migrationSource, /language plpgsql security definer/);
  assert.match(migrationSource, /set search_path = pg_catalog, public/);
  assert.match(migrationSource, /revoke all on function public\.queue_review_confirm_batch_compatible\(jsonb\)[\s\S]*from public, anon, authenticated/);
  assert.match(migrationSource, /grant execute on function public\.queue_review_confirm_batch_compatible\(jsonb\)[\s\S]*to authenticated/);
});
