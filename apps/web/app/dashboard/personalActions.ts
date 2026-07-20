"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  reviewConfirmBatchInput,
  reviewCommandInput,
} from "@/lib/personalReplica";
import { createClient } from "@/lib/supabase/server";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function workspaceNotice(
  screen: "daily" | "setup",
  message: string,
  settingsTab?: "data-control",
): string {
  const settingsQuery = settingsTab ? `&settings_tab=${settingsTab}` : "";
  return `/app?screen=${screen}${settingsQuery}&notice=${encodeURIComponent(message)}`;
}

export async function queuePersonalReviewCommand(formData: FormData): Promise<void> {
  const action = text(formData, "action");
  const patch = action === "relabel"
    ? { category: text(formData, "category") }
    : undefined;
  const input = reviewCommandInput({
    blockId: text(formData, "block_id"),
    weekId: text(formData, "week_id"),
    expectedRevision: text(formData, "expected_revision"),
    action,
    patch,
  });
  if (!input) redirect(workspaceNotice("daily", "That review request was invalid."));
  const supabase = await createClient();
  if (!supabase) redirect(workspaceNotice("daily", "Weekform Cloud is not configured."));
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app");
  const { data: pending, error: pendingError } = await supabase
    .from("review_commands")
    .select("command_id")
    .eq("block_id", input.blockId)
    .eq("week_id", input.weekId)
    .eq("expected_revision", input.expectedRevision)
    .eq("status", "pending")
    .limit(1);
  if (pendingError) redirect(workspaceNotice("daily", "Review request status could not be checked. No new request was queued."));
  if (pending && pending.length > 0) {
    redirect(workspaceNotice("daily", "A request for this block is already waiting for approval on your Mac."));
  }
  const { error } = await supabase.rpc("queue_review_command", {
    p_block_id: input.blockId,
    p_week_id: input.weekId,
    p_expected_revision: input.expectedRevision,
    p_action: input.action,
    p_patch: input.patch,
  });
  if (error) redirect(workspaceNotice("daily", error.message.includes("conflict") || error.message.includes("duplicate") || error.message.includes("already pending")
    ? "A request for this block is already waiting for approval, or the block changed on your Mac. Wait for the latest status and try again."
    : "The review request could not be queued."));
  revalidatePath("/app");
  redirect(workspaceNotice("daily", "Review request sent to your Mac. It will not change local truth until you approve it there."));
}

export async function queuePersonalReviewConfirmBatch(formData: FormData): Promise<void> {
  const serialized = text(formData, "targets");
  if (serialized.length === 0 || serialized.length > 20_000) {
    redirect(workspaceNotice("daily", "That Confirm all request was invalid."));
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    redirect(workspaceNotice("daily", "That Confirm all request was invalid."));
  }
  const commands = reviewConfirmBatchInput(value);
  if (!commands) redirect(workspaceNotice("daily", "That Confirm all request was invalid."));
  const supabase = await createClient();
  if (!supabase) redirect(workspaceNotice("daily", "Weekform Cloud is not configured."));
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app");
  const { error } = await supabase.rpc("queue_review_confirm_batch", {
    p_targets: commands,
  });
  if (error) {
    redirect(workspaceNotice(
      "daily",
      error.message.includes("conflict") || error.message.includes("already commanded")
        ? "Confirm all was not queued because a block changed or already has a different request. Reload and try again. No review requests were queued."
        : "Confirm all could not be queued. No review requests were queued.",
    ));
  }
  revalidatePath("/app");
  redirect(workspaceNotice(
    "daily",
    `${commands.length} confirmation request${commands.length === 1 ? "" : "s"} sent to your Mac. Local truth will not change until you approve them there.`,
  ));
}

export async function deletePersonalReplicaHistory(): Promise<void> {
  const supabase = await createClient();
  if (!supabase) redirect(workspaceNotice("setup", "Weekform Cloud is not configured.", "data-control"));
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/app");
  const { error } = await supabase.rpc("delete_personal_replica_history");
  if (error) redirect(workspaceNotice("setup", "Your private Web history could not be deleted.", "data-control"));
  revalidatePath("/app");
  redirect(workspaceNotice("setup", "Your private Web workspace history was deleted: replicas, all review-request lifecycle records across every week, and sync receipts. Local Mac data, team data, account, sign-in, and registered desktop devices were unchanged. Turn Private Web off on your Mac first if you do not want replicas recreated.", "data-control"));
}
