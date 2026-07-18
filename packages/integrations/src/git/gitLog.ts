import {
  importRawEvents,
  type ImportRawEventsOptions,
  type RawEventImport,
  type RawEventImportResult
} from "../import/rawEvents";

/**
 * Git activity → planned-work signal.
 *
 * Commits are deep-work evidence: a burst of commits in a repo over an
 * afternoon is a focused coding session. This module turns a *committed or
 * exported* git log (no network, no live process) into deep-work
 * `WorkBlock`s, keyed by repo → project, by:
 *   1. {@link parseGitLog} — text export → {@link GitCommitRecord}[]
 *   2. {@link gitCommitsToImport} — commits → session {@link RawEventImport}[]
 *      (consecutive commits in a repo collapse into one block)
 *   3. {@link importGitLog} — the full pipeline, normalized through the shared
 *      {@link importRawEvents} so capacity/id/dedup heuristics stay identical
 *      to every other source.
 *
 * ## Export contract (text)
 *
 * One commit per line, fields `|`-delimited, oldest-or-newest order (sorted
 * internally). Produce it with:
 *
 * ```sh
 * git log --pretty=format:'%H|%aI|%an|%s'
 * ```
 *
 * → `9f3a…|2026-06-22T14:05:00Z|Dana Lee|Add forecast accuracy trend`
 *
 * Lines starting with `#` are directives/comments. `# repo: <name>` sets the
 * repo for the commits that follow, so several repos' logs can be concatenated
 * into one export; commits before any directive use `options.repoName`.
 *
 * The `|` in a commit subject is preserved — only the first three separators
 * are treated as field boundaries; the rest of the line is the subject.
 *
 * The live `git log` fetch / file-watch is **[manual / Rust]** — it belongs in
 * `apps/desktop/src-tauri/` (process spawn + fs access) and is a follow-up.
 * This module is the pure, testable half that the Rust side will feed.
 */

/** A single parsed commit. */
export interface GitCommitRecord {
  hash: string;
  author: string;
  date: Date;
  subject: string;
  /** Repo the commit belongs to (project key). */
  repo: string;
  /** PR number from a merge or squash subject, when present. */
  pr_number: number | null;
}

export interface GitLogOptions extends ImportRawEventsOptions {
  /** Repo name for commits with no preceding `# repo:` directive. */
  repoName?: string;
  /** Commits more than this many minutes apart start a new session. */
  sessionGapMinutes?: number;
  /** Minutes of work assumed before a session's first commit. */
  leadMinutes?: number;
}

const DEFAULT_REPO = "Repository";
const DEFAULT_SESSION_GAP_MINUTES = 90;
const DEFAULT_LEAD_MINUTES = 30;

function parsePrNumber(subject: string): number | null {
  // GitHub merge ("Merge pull request #123 from …") or squash ("… (#123)").
  const match = subject.match(/(?:Merge pull request #|\(#)(\d+)/);
  return match ? Number(match[1]) : null;
}

function repoDirective(line: string): string | null {
  const match = line.match(/^#\s*repo:\s*(.+)$/i);
  return match ? match[1].trim() || null : null;
}

/**
 * Parse a `%H|%aI|%an|%s` git-log export into commit records. Blank lines and
 * `#` comments are ignored; a `# repo: <name>` comment scopes the commits that
 * follow. Malformed lines (missing fields or an unparseable date) are dropped,
 * mirroring `parseOutlookIcs`' lenient handling of invalid events.
 */
export function parseGitLog(content: string, options: GitLogOptions = {}): GitCommitRecord[] {
  const records: GitCommitRecord[] = [];
  let currentRepo = options.repoName?.trim() || DEFAULT_REPO;

  for (const rawLine of content.split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    if (line.startsWith("#")) {
      const repo = repoDirective(line);
      if (repo) {
        currentRepo = repo;
      }
      continue;
    }

    const parts = line.split("|");
    if (parts.length < 4) {
      continue;
    }
    const [hash, dateValue, author, ...subjectParts] = parts;
    const date = new Date(dateValue.trim());
    if (!hash.trim() || Number.isNaN(date.getTime())) {
      continue;
    }

    const subject = subjectParts.join("|").trim();
    records.push({
      hash: hash.trim(),
      author: author.trim() || "Unknown author",
      date,
      subject,
      repo: currentRepo,
      pr_number: parsePrNumber(subject)
    });
  }

  return records;
}

/**
 * Group commits into focus sessions and emit one `RawEventImport` per session.
 *
 * Commits are grouped by repo, sorted by time, then split wherever two
 * consecutive commits are more than `sessionGapMinutes` apart. Each session
 * spans `leadMinutes` before its first commit through its last commit (so even
 * a lone commit gets a non-zero block representing the work leading up to it).
 */
export function gitCommitsToImport(
  commits: GitCommitRecord[],
  options: GitLogOptions = {}
): RawEventImport[] {
  const gapMs = Math.max(0, options.sessionGapMinutes ?? DEFAULT_SESSION_GAP_MINUTES) * 60_000;
  const leadMs = Math.max(0, options.leadMinutes ?? DEFAULT_LEAD_MINUTES) * 60_000;

  const byRepo = new Map<string, GitCommitRecord[]>();
  for (const commit of commits) {
    const list = byRepo.get(commit.repo);
    if (list) {
      list.push(commit);
    } else {
      byRepo.set(commit.repo, [commit]);
    }
  }

  const imports: RawEventImport[] = [];
  for (const [repo, repoCommits] of byRepo) {
    const sorted = [...repoCommits].sort((a, b) => a.date.getTime() - b.date.getTime());
    let session: GitCommitRecord[] = [];

    const flush = () => {
      if (session.length === 0) {
        return;
      }
      const first = session[0];
      const last = session[session.length - 1];
      const end = last.date;
      // Pad backwards by leadMs, but never collapse to a zero-length span:
      // importRawEvents drops any record with end <= start, which would
      // silently lose a lone commit when leadMinutes is 0.
      const start = new Date(Math.min(first.date.getTime() - leadMs, end.getTime() - 60_000));
      const prNumbers = [...new Set(session.map((c) => c.pr_number).filter((n): n is number => n !== null))];
      const authors = [...new Set(session.map((c) => c.author))];

      const metadata: Record<string, string> = {
        repo,
        commits: String(session.length),
        authors: authors.join(", ")
      };
      if (prNumbers.length > 0) {
        metadata.pull_requests = prNumbers.map((n) => `#${n}`).join(", ");
      }

      imports.push({
        // Full commit SHA is globally unique, so the block dedups stably
        // without a repo slug that could collide across similarly-named repos.
        event_id: `git-${first.hash}`,
        timestamp_start: start.toISOString(),
        timestamp_end: end.toISOString(),
        source_type: "git",
        app_name: "git",
        project_hint: repo,
        project_name: repo,
        metadata
      });
      session = [];
    };

    for (const commit of sorted) {
      if (session.length > 0 && commit.date.getTime() - session[session.length - 1].date.getTime() > gapMs) {
        flush();
      }
      session.push(commit);
    }
    flush();
  }

  return imports;
}

/**
 * Full pipeline: parse a git-log export, sessionize it, and normalize through
 * {@link importRawEvents}. Returns `{ events, work_blocks, skipped }` exactly
 * like every other source import — the work blocks are deep-work, keyed by
 * repo → `project_name`.
 */
export function importGitLog(content: string, options: GitLogOptions = {}): RawEventImportResult {
  const commits = parseGitLog(content, options);
  const imports = gitCommitsToImport(commits, options);
  return importRawEvents(imports, { weekId: options.weekId, userId: options.userId });
}
