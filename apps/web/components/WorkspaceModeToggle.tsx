"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { UserRound, Waypoints } from "lucide-react";
import type { MouseEvent } from "react";
import { useEffect } from "react";

import {
  readWorkspaceModePreference,
  resolvePreferredWorkspaceRedirect,
  writeWorkspaceModePreference,
  type WorkspaceMode,
} from "@/lib/workspaceModePreference";

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
  const router = useRouter();

  useEffect(() => {
    if (mode !== "individual") {
      writeWorkspaceModePreference(window.sessionStorage, mode);
      return;
    }

    const preferredMode = readWorkspaceModePreference(window.sessionStorage);
    const redirectHref = resolvePreferredWorkspaceRedirect({
      currentMode: mode,
      preferredMode,
      teamAvailable,
      teamHref,
    });
    if (redirectHref) router.replace(redirectHref);
  }, [mode, router, teamAvailable, teamHref]);

  function rememberWorkspaceMode(
    event: MouseEvent<HTMLAnchorElement>,
    nextMode: WorkspaceMode,
  ) {
    if (
      event.button !== 0
      || event.metaKey
      || event.ctrlKey
      || event.shiftKey
      || event.altKey
    ) {
      return;
    }
    writeWorkspaceModePreference(window.sessionStorage, nextMode);
  }

  return (
    <nav className="workspace-mode-toggle" aria-label="Weekform workspace mode">
      <Link
        href={individualHref}
        aria-current={mode === "individual" ? "page" : undefined}
        onClick={(event) => rememberWorkspaceMode(event, "individual")}
      >
        <UserRound aria-hidden="true" />
        Individual
      </Link>
      {teamAvailable ? (
        <Link
          href={teamHref}
          aria-current={mode === "manager" || mode === "team" ? "page" : undefined}
          onClick={(event) => rememberWorkspaceMode(event, mode === "team" ? "team" : "manager")}
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
