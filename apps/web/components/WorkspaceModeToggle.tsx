import Link from "next/link";
import { UserRound, Waypoints } from "lucide-react";

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
        <UserRound aria-hidden="true" />
        Individual
      </Link>
      {teamAvailable ? (
        <Link
          href={teamHref}
          aria-current={mode === "manager" || mode === "team" ? "page" : undefined}
        >
          <Waypoints aria-hidden="true" />
          {teamLabel}
        </Link>
      ) : (
        <span aria-disabled="true" title="Team mode requires an active team membership">
          <Waypoints aria-hidden="true" />
          {teamLabel}
        </span>
      )}
    </nav>
  );
}
