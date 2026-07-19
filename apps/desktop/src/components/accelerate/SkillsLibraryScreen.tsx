import { useState } from "react";
import {
  Check,
  Copy,
  Download,
  FileCode2,
  Library,
  Lightbulb,
  Trash2,
  Workflow,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { AccelerationPlayType, SavedSkill } from "../../../../../packages/domain/src/models";
import type { Screen } from "../../lib/types";
import { accelerationTypeGloss, accelerationTypeLabel, formatAuditTime, formatDurationMinutes } from "../../lib/format";
import {
  downloadTextFile,
  exportFilename,
  exportMimeType,
  serializeSavedSkills,
  serializeSavedSkillAsSkillMd,
  serializeSavedSkillsAsSkillBundle,
} from "../../lib/dataExport";
import type { PushToast } from "../../hooks/useToasts";
import { EmptyState } from "../common/EmptyState";
import { ConfirmDialog } from "../common/ConfirmDialog";

const TYPE_ICONS: Record<AccelerationPlayType, LucideIcon> = {
  automate: Workflow,
  tool: Wrench,
  technique: Lightbulb,
};

function SavedSkillCard({
  skill,
  onRemove,
  pushToast,
}: {
  skill: SavedSkill;
  onRemove: (signalId: string) => void;
  pushToast: PushToast;
}) {
  // Fall back to Lightbulb for an off-enum play_type on a corrupt/legacy persisted skill —
  // `<Icon>` with an undefined component throws "Element type is invalid" and (no ErrorBoundary)
  // white-screens the whole app. Mirrors the `?? type` graceful degradation the sibling
  // accelerationTypeLabel/Gloss helpers already do for the raw string in this same card.
  const Icon = TYPE_ICONS[skill.play_type] ?? Lightbulb;
  const [copied, setCopied] = useState(false);
  const [copiedSkillMd, setCopiedSkillMd] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  async function copyRecipe() {
    try {
      // Non-optional so a missing clipboard (insecure webview) throws into the catch
      // rather than silently no-op'ing while we falsely announce success.
      await navigator.clipboard.writeText(skill.recipe);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
      pushToast({ tone: "success", message: "Recipe copied to clipboard" });
    } catch {
      pushToast({ tone: "error", message: "Couldn't copy to the clipboard" });
    }
  }

  async function copySkillMd() {
    try {
      await navigator.clipboard.writeText(serializeSavedSkillAsSkillMd(skill));
      setCopiedSkillMd(true);
      window.setTimeout(() => setCopiedSkillMd(false), 1200);
      pushToast({ tone: "success", message: "SKILL.md copied — paste into .agents/skills/<name>/SKILL.md" });
    } catch {
      pushToast({ tone: "error", message: "Couldn't copy to the clipboard" });
    }
  }

  function remove() {
    setConfirmingRemove(false);
    onRemove(skill.signal_id);
    pushToast({ tone: "info", message: `Removed "${skill.title}" from your Skills library` });
  }

  return (
    <article className="saved-skill-card">
      <div className="play-header">
        <span className={`play-type-chip ${skill.play_type}`} title={accelerationTypeGloss(skill.play_type)}>
          <Icon size={13} aria-hidden />
          <span>{accelerationTypeLabel(skill.play_type)}</span>
          <span className="sr-only">. {accelerationTypeGloss(skill.play_type)}</span>
        </span>
        <span className="saved-skill-meta" title={`Saved ${formatAuditTime(skill.saved_at)}`}>
          Saved <time dateTime={skill.saved_at}>{formatAuditTime(skill.saved_at)}</time>
          <span className="sr-only"> · estimated ~{formatDurationMinutes(skill.estimated_minutes_saved_per_week)} saved per week</span>
        </span>
      </div>
      <h3 className="play-title">{skill.title}</h3>
      {skill.detail && <p className="play-detail">{skill.detail}</p>}
      <pre className="saved-skill-recipe">{skill.recipe}</pre>
      {skill.recommended_tools.length > 0 && (
        <div className="play-tools">
          <span className="play-tools-label">Recommended tools</span>
          <ul className="play-tool-chips">
            {skill.recommended_tools.map((tool) => (
              <li key={tool} className="play-tool-chip">
                {tool}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="play-recipe-actions">
        <button
          type="button"
          className="play-recipe-action"
          title={copied ? "Copied" : "Copy this recipe to the clipboard"}
          aria-label={copied ? "Recipe copied to clipboard" : "Copy this recipe to the clipboard"}
          onClick={() => void copyRecipe()}
        >
          {copied ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
        <button
          type="button"
          className="play-recipe-action"
          title={copiedSkillMd ? "Copied" : "Copy as an Agent Skill (SKILL.md, ready for .agents/skills/)"}
          aria-label={copiedSkillMd ? "SKILL.md copied to clipboard" : "Copy as an Agent Skill SKILL.md file"}
          onClick={() => void copySkillMd()}
        >
          {copiedSkillMd ? <Check size={13} aria-hidden /> : <FileCode2 size={13} aria-hidden />}
          <span>{copiedSkillMd ? "Copied" : "SKILL.md"}</span>
        </button>
        <button
          type="button"
          className="play-recipe-action"
          title="Remove this skill from your library"
          aria-label={`Remove ${skill.title} from your library`}
          onClick={() => setConfirmingRemove(true)}
        >
          <Trash2 size={13} aria-hidden />
          <span>Remove</span>
        </button>
      </div>
      {confirmingRemove && (
        <ConfirmDialog
          title="Remove this saved skill?"
          description={`This removes “${skill.title}” from your Skills library. The saved recipe cannot be restored if its source play has changed.`}
          confirmLabel="Remove skill"
          onConfirm={remove}
          onCancel={() => setConfirmingRemove(false)}
        />
      )}
    </article>
  );
}

// The saved-skills library as its own tab in the Agent section (it was embedded
// at the bottom of the Acceleration screen, below the live plays). Skills are
// content snapshots keyed by signal_id, so they survive play regeneration and
// re-mining — this screen is where they live once saved from a play card.
export function SkillsLibraryScreen({
  savedSkills,
  onRemoveSkill,
  onOpenScreen,
  pushToast,
}: {
  savedSkills: SavedSkill[];
  onRemoveSkill: (signalId: string) => void;
  onOpenScreen: (screen: Screen) => void;
  pushToast: PushToast;
}) {
  // Newest first so the most recently saved skill is at the top.
  const ordered = [...savedSkills].sort((left, right) => right.saved_at.localeCompare(left.saved_at));

  function handleExport() {
    const content = serializeSavedSkills(ordered, "json");
    downloadTextFile(exportFilename("saved_skills", "json"), content, exportMimeType("json"));
    pushToast({ tone: "success", message: `Exported ${ordered.length} saved ${ordered.length === 1 ? "skill" : "skills"}` });
  }

  function handleExportSkills() {
    const now = new Date();
    const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const content = serializeSavedSkillsAsSkillBundle(ordered, now);
    downloadTextFile(`weekform-agent-skills-${stamp}.md`, content, "text/markdown");
    pushToast({
      tone: "success",
      message: `Exported ${ordered.length} Agent ${ordered.length === 1 ? "Skill" : "Skills"} (SKILL.md)`,
    });
  }

  if (savedSkills.length === 0) {
    return (
      <section className="screen skills-screen">
        <div className="screen-header">
          <div>
            <p className="eyebrow">Skills library</p>
            <h1>No saved skills yet.</h1>
          </div>
        </div>
        <EmptyState
          icon={Library}
          title="Your skills library is empty."
          description="When an acceleration play comes with a recipe, use its “Save to library” action to snapshot it here. Saved skills survive play regeneration and can be exported as Agent Skills."
        >
          <button className="primary-action" type="button" onClick={() => onOpenScreen("accelerate")}>
            <span>Browse acceleration plays</span>
          </button>
        </EmptyState>
      </section>
    );
  }

  return (
    <section className="screen skills-screen">
      <div className="screen-header">
        <div>
          <p className="eyebrow">Skills library</p>
          <h1>
            {ordered.length} saved {ordered.length === 1 ? "skill recipe" : "skill recipes"}.
          </h1>
          <p className="screen-subhead">
            Snapshotted from acceleration plays, so they survive regeneration. Copy a recipe, export
            the set, or remove ones you've outgrown.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" className="secondary-action" onClick={handleExportSkills}>
            <FileCode2 size={16} aria-hidden />
            <span>Export as Agent Skills</span>
          </button>
          <button type="button" className="secondary-action" onClick={handleExport}>
            <Download size={16} aria-hidden />
            <span>Export JSON</span>
          </button>
        </div>
      </div>
      <div className="play-grid">
        <h2 className="sr-only">Saved skill recipes</h2>
        {ordered.map((skill) => (
          <SavedSkillCard
            key={skill.signal_id}
            skill={skill}
            onRemove={onRemoveSkill}
            pushToast={pushToast}
          />
        ))}
      </div>
    </section>
  );
}
