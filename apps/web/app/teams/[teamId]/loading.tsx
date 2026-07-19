export default function TeamLoading() {
  return (
    <main className="container" aria-busy="true" aria-label="Loading team">
      <div className="page-head">
        <div className="skeleton" style={{ height: 34, width: "35%" }} />
        <div
          className="skeleton"
          style={{ height: 18, width: "50%", marginTop: 12 }}
        />
      </div>
      <div className="skeleton" style={{ height: 180, marginTop: 24 }} />
      <div className="skeleton" style={{ height: 220, marginTop: 16 }} />
    </main>
  );
}
