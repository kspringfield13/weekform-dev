"use client";

export default function TeamError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="container">
      <div className="page-head">
        <h1>Team</h1>
      </div>
      <div className="error-panel" role="alert">
        <h2>Something went wrong loading this team</h2>
        <p>
          This is usually temporary. Your team data was not changed. Try again,
          and if it keeps happening, go back to the dashboard.
        </p>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => reset()}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
