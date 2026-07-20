import Link from "next/link";

interface WorkspaceModeToggleProps {
  managerHref: string;
  managerAvailable: boolean;
  mode: "individual" | "manager";
}

export function WorkspaceModeToggle({
  managerHref,
  managerAvailable,
  mode,
}: WorkspaceModeToggleProps) {
  return (
    <nav className="workspace-mode-toggle" aria-label="Weekform workspace mode">
      <Link
        href="/app"
        aria-current={mode === "individual" ? "page" : undefined}
      >
        <span aria-hidden="true">●</span>
        Individual
      </Link>
      {managerAvailable ? (
        <Link
          href={managerHref}
          aria-current={mode === "manager" ? "page" : undefined}
        >
          <span aria-hidden="true">●●</span>
          Manager mode
        </Link>
      ) : (
        <span aria-disabled="true" title="Manager mode requires an owner or manager team role">
          <span aria-hidden="true">●●</span>
          Manager mode
        </span>
      )}
    </nav>
  );
}
