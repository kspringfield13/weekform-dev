import { useEffect, useId, useRef, type KeyboardEvent } from "react";
import { ShieldCheck, X } from "lucide-react";
import type { CapacityDetailModel } from "../../services/capacityDetail";

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}

export function CapacityDetailModal({
  model,
  onClose,
}: {
  model: CapacityDetailModel;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = `${useId()}-capacity-title`;
  const descriptionId = `${useId()}-capacity-description`;
  const capacity = model.capacity === null ? 0 : clampPercent(model.capacity);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      className="capacity-detail-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        className="capacity-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        data-capacity-scope={model.scope}
        onKeyDown={handleKeyDown}
      >
        <header className="capacity-detail-header">
          <div>
            <span className="capacity-detail-scope">
              <i aria-hidden />
              {model.eyebrow}
            </span>
            <h2 id={titleId}>{model.title}</h2>
            <p id={descriptionId}>{model.description}</p>
          </div>
          <button
            ref={closeRef}
            aria-label="Close capacity detail"
            type="button"
            onClick={onClose}
          >
            <X size={17} aria-hidden />
          </button>
        </header>

        <div className="capacity-detail-body">
          <div className="capacity-detail-hero">
            <div
              className={`capacity-detail-gauge${model.hasEvidence ? "" : " is-empty"}`}
              role="img"
              aria-label={model.capacity === null
                ? "Reliable capacity is not available"
                : `${model.capacity}% reliable capacity, ${model.caption.toLocaleLowerCase()}`}
            >
              <svg viewBox="0 0 180 180" aria-hidden="true">
                <circle className="capacity-detail-gauge-track" cx="90" cy="90" r="70" pathLength="100" />
                <circle
                  className="capacity-detail-gauge-value"
                  cx="90"
                  cy="90"
                  r="70"
                  pathLength="100"
                  strokeDasharray={`${capacity} ${100 - capacity}`}
                  transform="rotate(-90 90 90)"
                />
              </svg>
              <span aria-hidden="true">
                <strong>{model.capacity === null ? "—" : `${model.capacity}%`}</strong>
                <small>{model.caption}</small>
              </span>
            </div>
            <p>Reliable capacity is the estimated share that can absorb new planned work without likely slippage.</p>
          </div>

          <div className="capacity-detail-signals">
            {model.scope === "manager" && model.capacitySpread.length > 0 && (
              <section className="capacity-detail-spread" aria-labelledby={`${titleId}-spread`}>
                <div>
                  <span>Approved headroom spread</span>
                  <small>{model.capacitySpread.length} shared {model.capacitySpread.length === 1 ? "value" : "values"}</small>
                </div>
                <div className="capacity-spread-track" aria-hidden="true">
                  <i />
                  {model.capacitySpread.map((value, index) => (
                    <b key={`${value}-${index}`} style={{ left: `${value}%` }} />
                  ))}
                </div>
                <div className="capacity-spread-scale" id={`${titleId}-spread`}><span>0%</span><span>50%</span><span>100%</span></div>
                <span className="sr-only">Shared reliable-capacity values: {model.capacitySpread.map((value) => `${Math.round(value)}%`).join(", ")}</span>
              </section>
            )}

            <section className="capacity-detail-bands" aria-label={model.scope === "manager" ? "Team signal bands" : "Weekly workload pressures"}>
              {model.bands.length > 0 ? model.bands.map((band) => (
                <div key={band.key} data-band={band.key}>
                  <span>{band.label}</span>
                  <i aria-hidden="true"><b style={{ width: `${clampPercent(band.value)}%` }} /></i>
                  <strong>{band.count ?? `${Math.round(band.value)}%`}</strong>
                </div>
              )) : (
                <div className="capacity-detail-empty">
                  <strong>No weekly picture yet</strong>
                  <span>Review or confirm work blocks to make this capacity view available.</span>
                </div>
              )}
            </section>
          </div>
        </div>

        {model.stats.length > 0 && (
          <div className="capacity-detail-stats">
            {model.stats.map((stat) => <div key={stat.label}><span>{stat.label}</span><strong>{stat.value}</strong></div>)}
          </div>
        )}

        <footer className="capacity-detail-note">
          <ShieldCheck size={14} aria-hidden />
          <span>{model.evidenceNote}</span>
        </footer>
      </section>
    </div>
  );
}
