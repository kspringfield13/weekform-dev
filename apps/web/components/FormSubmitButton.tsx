"use client";

import type { MouseEvent, ReactNode } from "react";
import { useFormStatus } from "react-dom";

interface FormSubmitButtonProps {
  children: ReactNode;
  pendingLabel: string;
  className: string;
  disabled?: boolean;
  confirmMessage?: string;
}

/** Shared pending + optional confirmation treatment for server-action forms. */
export function FormSubmitButton({
  children,
  pendingLabel,
  className,
  disabled = false,
  confirmMessage,
}: FormSubmitButtonProps) {
  const { pending } = useFormStatus();

  function confirmSubmission(event: MouseEvent<HTMLButtonElement>) {
    if (confirmMessage && !window.confirm(confirmMessage)) {
      event.preventDefault();
    }
  }

  return (
    <button
      type="submit"
      className={className}
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={confirmSubmission}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
