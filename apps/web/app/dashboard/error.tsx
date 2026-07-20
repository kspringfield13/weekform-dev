"use client";

import { IndividualDashboardBoundaryShell } from "@/components/IndividualDashboardBoundaryShell";

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <IndividualDashboardBoundaryShell>
      <section className="web-desktop-screen dashboard-boundary-error-screen">
        <div className="web-screen-heading">
          <div><span>Workspace unavailable</span><h1>Your Weekform workspace could not load.</h1></div>
        </div>
        <div className="error-panel dashboard-boundary-error" role="alert">
          <h2>Your review-safe data was not changed</h2>
          <p>
            This is usually temporary. Try loading the workspace again. If the
            problem continues, sign out and back in.
          </p>
          <button type="button" className="button button-secondary" onClick={() => reset()}>
            Try again
          </button>
        </div>
      </section>
    </IndividualDashboardBoundaryShell>
  );
}
