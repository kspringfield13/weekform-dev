export interface ConnectorOperation {
  isCurrent: () => boolean;
  finish: () => void;
}

export interface ConnectorResetBoundary {
  begin: () => ConnectorOperation | null;
  /** Close synchronously, invalidate prior operations, then await their completion. */
  quiesce: () => Promise<void>;
  reopen: () => void;
}

/**
 * Renderer-side completion barrier for native connector commands. Reset closes
 * the boundary before its first await, so no new command can start while every
 * already-issued invoke is allowed to settle before native storage is deleted.
 */
export function createConnectorResetBoundary(): ConnectorResetBoundary {
  let epoch = 0;
  let quiescing = false;
  const activeCompletions = new Set<Promise<void>>();

  return {
    begin: () => {
      if (quiescing) return null;
      const operationEpoch = epoch;
      let resolveCompletion!: () => void;
      const completion = new Promise<void>((resolve) => { resolveCompletion = resolve; });
      activeCompletions.add(completion);
      let finished = false;
      return {
        isCurrent: () => !quiescing && epoch === operationEpoch,
        finish: () => {
          if (finished) return;
          finished = true;
          activeCompletions.delete(completion);
          resolveCompletion();
        },
      };
    },
    quiesce: async () => {
      quiescing = true;
      epoch += 1;
      await Promise.allSettled([...activeCompletions]);
    },
    reopen: () => {
      quiescing = false;
    },
  };
}
