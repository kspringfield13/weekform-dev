import { Mail } from "lucide-react";

/** Honest placeholder for a source Weekform does not connect to today. */
export function EmailSourcePanel() {
  return (
    <section className="settings-row email-source" aria-labelledby="email-source-title">
      <div className="settings-row-icon"><Mail size={18} aria-hidden /></div>
      <div>
        <h3 id="email-source-title">Email</h3>
        <p>Weekform does not connect to an email inbox today. Neither Mac nor Web requests inbox access or imports message content.</p>
      </div>
      <div className="settings-row-status">
        <strong>Unavailable today</strong>
        <span>No inbox access or message content import</span>
      </div>
      <span className="source-status is-unavailable" aria-label="Email unavailable">Unavailable</span>
    </section>
  );
}
