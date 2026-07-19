"use client";

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="container">
      <div className="page-head">
        <h1>Dashboard</h1>
      </div>
      <div className="error-panel" role="alert">
        <h2>Something went wrong loading your dashboard</h2>
        <p>
          This is usually temporary. Your data was not changed. Try again, and
          if it keeps happening, sign out and back in.
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
