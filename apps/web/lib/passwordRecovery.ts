export function normalizePasswordResetEmail(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email || null;
}

export type ReplacementPasswordValidation =
  | { ok: true; password: string }
  | { ok: false; message: string };

export function validateReplacementPassword(
  passwordValue: FormDataEntryValue | null,
  confirmationValue: FormDataEntryValue | null,
): ReplacementPasswordValidation {
  const password = typeof passwordValue === "string" ? passwordValue : "";
  const confirmation = typeof confirmationValue === "string" ? confirmationValue : "";
  if (password.length < 8) {
    return { ok: false, message: "Use a password of at least 8 characters." };
  }
  if (password !== confirmation) {
    return { ok: false, message: "The passwords do not match." };
  }
  return { ok: true, password };
}
