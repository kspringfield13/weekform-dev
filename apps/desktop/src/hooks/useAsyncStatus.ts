import { useRef, useState } from "react";

export function createAsyncOperationEpoch() {
  let value = 0;
  return {
    start(): number {
      value += 1;
      return value;
    },
    invalidate(): void {
      value += 1;
    },
    isCurrent(token: number): boolean {
      return token === value;
    },
  };
}

export function useAsyncStatus<T extends string>(idleValue: T) {
  type Status = T | "error";
  const [status, setStatus] = useState<Status>(idleValue);
  const [error, setError] = useState<string | null>(null);
  const operationEpoch = useRef<ReturnType<typeof createAsyncOperationEpoch> | null>(null);
  if (operationEpoch.current === null) operationEpoch.current = createAsyncOperationEpoch();

  return [
    status,
    error,
    {
      setStatus,
      start(busyValue: T) {
        const token = operationEpoch.current!.start();
        setStatus(busyValue);
        setError(null);
        return token;
      },
      isCurrent(token: number) { return operationEpoch.current!.isCurrent(token); },
      reset() {
        operationEpoch.current!.invalidate();
        setStatus(idleValue);
        setError(null);
      },
      fail(message: string) { setStatus("error" as Status); setError(message); },
    },
  ] as const;
}
