import { Maximize2, PictureInPicture2 } from "lucide-react";
import { WeekformMark } from "../common/WeekformMark";
import {
  openCompactWebWindow,
  restoreFullWebWindowFromHandoff,
} from "../../services/webWindowMode";

export function CompactWindowHandoff() {
  return (
    <main className="compact-window-handoff">
      <section className="compact-window-handoff-card" aria-labelledby="compact-window-handoff-title">
        <div className="compact-window-handoff-mark" aria-hidden="true">
          <WeekformMark />
        </div>
        <p className="eyebrow">Compact window active</p>
        <h1 id="compact-window-handoff-title">Weekform is standing by at the top right.</h1>
        <p>
          Keep this tab open while the compact window is active. Return to the full workspace whenever you need the wider view.
        </p>
        <div className="compact-window-handoff-actions">
          <button className="primary-action" type="button" onClick={() => openCompactWebWindow()}>
            <PictureInPicture2 size={16} aria-hidden />
            Show compact window
          </button>
          <button className="secondary-action" type="button" onClick={() => restoreFullWebWindowFromHandoff()}>
            <Maximize2 size={16} aria-hidden />
            Return to full view
          </button>
        </div>
      </section>
    </main>
  );
}
