export default function DashboardLoading() {
  return (
    <main className="container" aria-busy="true" aria-label="Loading dashboard">
      <div className="page-head">
        <div className="skeleton" style={{ height: 34, width: "40%" }} />
        <div
          className="skeleton"
          style={{ height: 18, width: "60%", marginTop: 12 }}
        />
      </div>
      <div className="card-grid">
        <div className="skeleton" style={{ height: 180 }} />
        <div className="skeleton" style={{ height: 180 }} />
        <div className="skeleton" style={{ height: 180 }} />
      </div>
    </main>
  );
}
