export function WebEditionBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`web-edition-badge${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      WEB
    </span>
  );
}
