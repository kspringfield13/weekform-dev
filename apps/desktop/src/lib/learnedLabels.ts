import type { WorkBlock } from "../../../../packages/domain/src/models";
import type { CorrectionBias } from "../../../../packages/inference/src/capacity";

// Bridges the correction-bias analysis to the review UI: a block "label" matches a
// learned correction when its current value equals the `to_value` the user has
// systematically relabeled toward, so the card can show a "learned from your edits"
// note. Pure and label-only — never reads window titles or app names.

export interface LearnedLabelMatch {
  field: CorrectionBias["field"];
  from_value: string;
  to_value: string;
  count: number;
}

// Stringify the block field the same way corrections are recorded (App.addCorrection
// uses String(...)), so boolean blocker_flag compares as "true"/"false".
function blockFieldValue(block: WorkBlock, field: CorrectionBias["field"]): string {
  switch (field) {
    case "category":
      return block.category;
    case "mode":
      return block.mode;
    case "planned_status":
      return block.planned_status;
    case "stakeholder_group":
      return block.stakeholder_group;
    case "blocker_flag":
      return String(block.blocker_flag);
    default:
      return "";
  }
}

/**
 * Which systematic correction biases this block's current labels reflect. A match
 * means the label equals a value the user consistently corrects toward — i.e. the
 * classifier likely pre-applied the learned preference.
 */
export function learnedLabelsForBlock(
  block: WorkBlock,
  biases: CorrectionBias[],
): LearnedLabelMatch[] {
  return biases
    .filter((bias) => blockFieldValue(block, bias.field) === bias.to_value)
    .map((bias) => ({
      field: bias.field,
      from_value: bias.from_value,
      to_value: bias.to_value,
      count: bias.count,
    }));
}
