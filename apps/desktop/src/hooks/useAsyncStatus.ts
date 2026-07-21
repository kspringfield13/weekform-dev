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

export type AsyncOperationEpoch = ReturnType<typeof createAsyncOperationEpoch>;

export function createAsyncOperationGate() {
  const epoch = createAsyncOperationEpoch();
  let closed = false;
  return {
    begin(): number | null {
      return closed ? null : epoch.start();
    },
    close(): void {
      closed = true;
      epoch.invalidate();
    },
    open(): void {
      epoch.invalidate();
      closed = false;
    },
    isCurrent(token: number): boolean {
      return !closed && epoch.isCurrent(token);
    },
  };
}

export type AsyncOperationGate = ReturnType<typeof createAsyncOperationGate>;

export type ResetInProgressRef = { readonly current: boolean };

export const RESET_IN_PROGRESS_AI_MESSAGE =
  "AI generation is unavailable while local data is resetting.";

export function isResetInProgress(resetInProgressRef: ResetInProgressRef): boolean {
  return resetInProgressRef.current;
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
