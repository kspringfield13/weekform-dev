import type { WorkBlock } from "../../../../packages/domain/src/models";

export interface BlockOrigin {
  label: string;
  title: string;
}

/** Content-free provenance label for a review card. */
export function blockOrigin(block: Pick<WorkBlock, "work_block_id" | "derived_from">): BlockOrigin {
  const ids = [block.work_block_id, ...block.derived_from];
  if (ids.some((id) => id.startsWith("calendar-"))) {
    return { label: "Calendar", title: "Derived from your connected or local calendar" };
  }
  if (
    block.work_block_id.startsWith("chat-review-") ||
    ids.some((id) => id.startsWith("chat-"))
  ) {
    return { label: "Chat", title: "Derived from content-free workplace Chat evidence" };
  }
  return { label: "Activity capture", title: "Captured from your foreground-app activity" };
}
