type PendingWrite<T> = {
  generation: number;
  value: T;
  waiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }>;
};

/**
 * A single-writer, latest-snapshot-wins persistence lane.
 *
 * React can produce several complete state snapshots while one disk write is in
 * flight. Only the newest queued snapshot needs to follow that active write;
 * every superseded caller resolves when the newest snapshot is durable. Clear
 * establishes a generation boundary, waits for the active writer, discards any
 * queued pre-clear snapshot, and only then runs the caller's verified deletion.
 */
export function createPersistenceCoordinator<T>(writer: (value: T) => Promise<void>) {
  let generation = 0;
  let pending: PendingWrite<T> | null = null;
  let draining: Promise<void> | null = null;
  let clearInFlight: Promise<void> | null = null;

  const settle = (batch: PendingWrite<T>, error?: unknown) => {
    for (const waiter of batch.waiters) {
      if (error === undefined) waiter.resolve();
      else waiter.reject(error);
    }
  };

  const drain = async () => {
    while (pending && clearInFlight === null) {
      const batch = pending;
      pending = null;
      if (batch.generation !== generation) {
        settle(batch);
        continue;
      }
      try {
        await writer(batch.value);
        settle(batch);
      } catch (error) {
        settle(batch, error);
      }
    }
  };

  const kick = () => {
    if (draining || clearInFlight || !pending) return;
    draining = drain().finally(() => {
      draining = null;
      kick();
    });
  };

  return {
    schedule(value: T): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        // A render produced while reset/sign-out is deleting durable state is
        // part of that transition, not a fresh post-clear snapshot. Resolving
        // without queuing prevents it from recreating the just-deleted state.
        if (clearInFlight) {
          resolve();
          return;
        }
        if (pending && pending.generation === generation) {
          pending.value = value;
          pending.waiters.push({ resolve, reject });
        } else {
          pending = {
            generation,
            value,
            waiters: [{ resolve, reject }],
          };
        }
        kick();
      });
    },

    clear(clearer: () => Promise<void>): Promise<void> {
      // Reset can be requested through more than one surface in the same turn.
      // They share one deletion boundary; a second clearer must not race the
      // first or prematurely reopen the write lane.
      if (clearInFlight) return clearInFlight;

      let resolveClear!: () => void;
      let rejectClear!: (error: unknown) => void;
      const sharedClear = new Promise<void>((resolve, reject) => {
        resolveClear = resolve;
        rejectClear = reject;
      });
      clearInFlight = sharedClear;
      generation += 1;
      if (pending) {
        settle(pending);
        pending = null;
      }

      void (async () => {
        try {
          if (draining) await draining;
          await clearer();
          clearInFlight = null;
          kick();
          resolveClear();
        } catch (error) {
          clearInFlight = null;
          kick();
          rejectClear(error);
        }
      })();

      return sharedClear;
    },
  };
}
