export function WebEditionLabel({ className = "" }: { className?: string }) {
  return (
    <span
      className={`web-edition-label${className ? ` ${className}` : ""}`}
      aria-hidden="true"
    >
      Web
    </span>
  );
}
