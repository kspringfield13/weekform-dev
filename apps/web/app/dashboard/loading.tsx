import { IndividualDashboardBoundaryShell } from "@/components/IndividualDashboardBoundaryShell";

export default function DashboardLoading() {
  return (
    <IndividualDashboardBoundaryShell>
      <section className="web-desktop-screen dashboard-boundary-loading" aria-busy="true" aria-label="Loading dashboard">
        <div className="web-screen-heading">
          <div>
            <div className="skeleton dashboard-boundary-eyebrow" />
            <div className="skeleton dashboard-boundary-title" />
            <div className="skeleton dashboard-boundary-copy" />
          </div>
        </div>
        <div className="dashboard-boundary-metric-grid" aria-hidden="true">
          {Array.from({ length: 4 }, (_, index) => <div className="skeleton" key={index} />)}
        </div>
        <div className="dashboard-boundary-panel-grid" aria-hidden="true">
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      </section>
    </IndividualDashboardBoundaryShell>
  );
}
