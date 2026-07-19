"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { reviewCommandInput } from "@/lib/personalReplica";
import { createClient } from "@/lib/supabase/server";

function text(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
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
  if (!input) redirect("/dashboard?notice=That review request was invalid.");
  const supabase = await createClient();
  if (!supabase) redirect("/dashboard?notice=Weekform Cloud is not configured.");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard");
  const { error } = await supabase.rpc("queue_review_command", {
    p_block_id: input.blockId,
    p_week_id: input.weekId,
    p_expected_revision: input.expectedRevision,
    p_action: input.action,
    p_patch: input.patch,
  });
  if (error) redirect(`/dashboard?notice=${encodeURIComponent(error.message.includes("conflict") ? "That block changed on your Mac. Wait for the latest replica and try again." : "The review request could not be queued.")}`);
  revalidatePath("/dashboard");
  redirect("/dashboard?notice=Review request sent to your Mac. It will not change local truth until you approve it there.");
}

export async function deletePersonalReplicaHistory(): Promise<void> {
  const supabase = await createClient();
  if (!supabase) redirect("/dashboard?notice=Weekform Cloud is not configured.");
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/dashboard");
  const { error } = await supabase.rpc("delete_personal_replica_history");
  if (error) redirect("/dashboard?notice=Your private Web history could not be deleted.");
  revalidatePath("/dashboard");
  redirect("/dashboard?notice=Your private Web replicas and pending review requests were deleted. Turn the Web workspace off on your Mac first if you do not want it recreated.");
}
