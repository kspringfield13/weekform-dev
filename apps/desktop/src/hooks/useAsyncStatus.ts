import { useState } from "react";

export function useAsyncStatus<T extends string>(idleValue: T) {
  type Status = T | "error";
  const [status, setStatus] = useState<Status>(idleValue);
  const [error, setError] = useState<string | null>(null);

  return [
    status,
    error,
    {
      setStatus,
      start(busyValue: T) { setStatus(busyValue); setError(null); },
      reset() { setStatus(idleValue); setError(null); },
      fail(message: string) { setStatus("error" as Status); setError(message); },
    },
  ] as const;
}
