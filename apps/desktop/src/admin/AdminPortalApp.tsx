import { type FormEvent, useState } from "react";
import { ArrowRight, FlaskConical, LockKeyhole, ShieldCheck } from "lucide-react";
import {
  authenticateLocalSimulatorAdmin,
  LOCAL_SIMULATOR_ADMIN_EMAIL,
  LOCAL_SIMULATOR_ADMIN_PASSWORD,
  SPAN_SIMULATOR_ADMIN_HREF
} from "../../../../packages/simulator/src/authorization";
import { WeekformMark } from "../components/common/WeekformMark";
import "./span-simulator.css";

const LOCAL_ADMIN_PORTAL_ENABLED = import.meta.env.DEV
  && import.meta.env.VITE_ENABLE_SPAN_SIMULATOR === "true";

export function AdminPortalRoot() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const decision = authenticateLocalSimulatorAdmin(LOCAL_ADMIN_PORTAL_ENABLED, email, password);
    if (!decision.allowed) {
      setError(decision.reason);
      return;
    }
    window.location.assign(SPAN_SIMULATOR_ADMIN_HREF);
  };

  if (!LOCAL_ADMIN_PORTAL_ENABLED) {
    return (
      <main className="sim-access-shell">
        <section className="sim-access-card" aria-labelledby="admin-portal-locked-title">
          <div className="sim-access-mark"><LockKeyhole /></div>
          <span className="sim-kicker">Weekform admin portal</span>
          <h1 id="admin-portal-locked-title">Admin Portal is locked.</h1>
          <p>This local-only portal is available in development when the Span Simulator feature flag is enabled.</p>
          <div className="sim-gate-note">
            <ShieldCheck size={17} aria-hidden />
            <div>
              <strong>Production access remains separate</strong>
              <span>Real simulator administration requires authenticated Supabase access and an explicit simulator-admin grant.</span>
            </div>
          </div>
          <a className="sim-button secondary" href="/">Return to Weekform</a>
        </section>
      </main>
    );
  }

  return (
    <main className="sim-access-shell">
      <section className="sim-access-card admin-portal-card" aria-labelledby="admin-portal-title">
        <div className="sim-access-mark"><WeekformMark /></div>
        <span className="sim-kicker">Weekform admin portal</span>
        <h1 id="admin-portal-title">Open Span Simulator</h1>
        <p>Sign in with the synthetic local demo account. These credentials have no production or cloud access.</p>

        <form className="sim-form-grid admin-portal-form" onSubmit={submit}>
          <label>
            <span>Email</span>
            <input
              autoComplete="username"
              autoFocus
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              value={email}
            />
          </label>
          <label>
            <span>Password</span>
            <input
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          {error && <p className="admin-portal-error" role="alert">{error}</p>}
          <button className="sim-button primary" type="submit">
            Sign in to Admin Portal <ArrowRight size={15} aria-hidden />
          </button>
        </form>

        <div className="sim-gate-note admin-demo-credentials">
          <FlaskConical size={17} aria-hidden />
          <div>
            <strong>Local demo credentials</strong>
            <span>Email: <code>{LOCAL_SIMULATOR_ADMIN_EMAIL}</code></span>
            <span>Password: <code>{LOCAL_SIMULATOR_ADMIN_PASSWORD}</code></span>
          </div>
        </div>
        <a className="admin-portal-return" href="/">Return to Weekform</a>
      </section>
    </main>
  );
}
