import Link from "next/link";

interface WorkspaceModeToggleProps {
  teamHref: string;
  teamAvailable: boolean;
  mode: "individual" | "manager" | "team";
  individualHref?: string;
  teamLabel?: "Manager mode" | "Team";
}

export function WorkspaceModeToggle({
  teamHref,
  teamAvailable,
  mode,
  individualHref = "/app",
  teamLabel = mode === "team" ? "Team" : "Manager mode",
}: WorkspaceModeToggleProps) {
  return (
    <nav className="workspace-mode-toggle" aria-label="Weekform workspace mode">
      <Link
        href={individualHref}
        aria-current={mode === "individual" ? "page" : undefined}
      >
        <span aria-hidden="true">●</span>
        Individual
      </Link>
      {teamAvailable ? (
        <Link
          href={teamHref}
          aria-current={mode === "manager" || mode === "team" ? "page" : undefined}
        >
          <span aria-hidden="true">●●</span>
          {teamLabel}
        </Link>
      ) : (
        <span aria-disabled="true" title="Team mode requires an active team membership">
          <span aria-hidden="true">●●</span>
          {teamLabel}
        </span>
      )}
    </nav>
  );
}
