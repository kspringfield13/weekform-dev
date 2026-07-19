// The consent preview: renders the EXACT SharedWorkloadSnapshotV1 the shared builder
// produced (the same object reference "Sync Now" uploads) — human-readable lines plus
// the verbatim JSON. Never a second calculation, so the preview cannot claim more or
// less than the sync sends.

import type { SharedSnapshotBuildResult } from "../../../../../packages/inference/src/sharedSnapshot";

export function SharePreview({
  result,
  teamName
}: {
  result: SharedSnapshotBuildResult;
  teamName: string | null;
}) {
  if (!result.ok) {
    return (
      <div className="cloud-share-preview is-empty" role="note">
        <p>{result.message}</p>
      </div>
    );
  }
  const { payload, lines } = result.preview;
  return (
    <div className="cloud-share-preview">
      <p className="cloud-share-preview-recipient">
        Recipient: <strong>{teamName ? `${teamName} (${payload.teamId})` : `team ${payload.teamId}`}</strong>
        {" · "}week {payload.weekId} · client snapshot id <code>{payload.clientSnapshotId}</code>
      </p>
      <ul className="cloud-share-preview-lines">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <details className="cloud-share-preview-json">
        <summary>Exact JSON that will be uploaded</summary>
        <pre aria-label="Exact JSON payload that will be uploaded">
          <code>{JSON.stringify(payload, null, 2)}</code>
        </pre>
      </details>
    </div>
  );
}
