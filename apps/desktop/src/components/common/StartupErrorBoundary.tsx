import { Component, type ReactNode } from "react";

type StartupErrorBoundaryProps = {
  children: ReactNode;
};

type StartupErrorBoundaryState = {
  failed: boolean;
};

export class StartupErrorBoundary extends Component<
  StartupErrorBoundaryProps,
  StartupErrorBoundaryState
> {
  state: StartupErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): StartupErrorBoundaryState {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <main className="startup-recovery" role="alert" aria-labelledby="startup-recovery-title">
        <div className="startup-recovery-card">
          <span className="startup-recovery-mark" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </span>
          <p className="startup-recovery-kicker">Weekform for macOS</p>
          <h1 id="startup-recovery-title">Weekform couldn’t finish opening.</h1>
          <p>
            Reload the interface to try again. Your local data has not been reset,
            deleted, or shared.
          </p>
          <button type="button" className="primary-button" onClick={() => window.location.reload()}>
            Reload Weekform
          </button>
        </div>
      </main>
    );
  }
}
