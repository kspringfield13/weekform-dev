import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CalendarEvent } from "../../../../packages/domain/src/models";
import type {
  CalendarProviderId,
  CalendarRange,
  CalendarTransferMode,
} from "../../../../packages/integrations/src/calendar/calendarSync";
import {
  createConnectorResetBoundary,
  type ConnectorResetBoundary,
} from "./connectorResetBoundary";

export interface CalendarConnectionStatus {
  provider: CalendarProviderId;
  available: boolean;
  connected: boolean;
  detail: string;
}

export interface CalendarProviderActivity {
  phase: "idle" | "connecting" | "syncing" | "error";
  message: string | null;
  last_synced_at: string | null;
}

export interface CalendarSourcesController {
  statuses: CalendarConnectionStatus[];
  activity: Record<CalendarProviderId, CalendarProviderActivity>;
  refreshStatuses: () => Promise<void>;
  connect: (provider: CalendarProviderId, range: CalendarRange) => Promise<void>;
  sync: (provider: CalendarProviderId, range: CalendarRange) => Promise<void>;
  disconnect: (provider: CalendarProviderId) => Promise<void>;
  quiesceForReset: () => Promise<void>;
  clearNativeStateForReset: () => Promise<boolean>;
  resumeAfterReset: () => void;
}

const EMPTY_ACTIVITY: CalendarProviderActivity = {
  phase: "idle",
  message: null,
  last_synced_at: null,
};

const INITIAL_ACTIVITY: Record<CalendarProviderId, CalendarProviderActivity> = {
  outlook: EMPTY_ACTIVITY,
  google: EMPTY_ACTIVITY,
  apple: EMPTY_ACTIVITY,
};

function rollingLiveRange(): CalendarRange {
  const today = new Date();
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 14);
  const endExclusive = new Date(today);
  endExclusive.setHours(0, 0, 0, 0);
  endExclusive.setDate(endExclusive.getDate() + 43);
  const dateKey = (value: Date) => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };
  const inclusiveEnd = new Date(endExclusive);
  inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
  return {
    start_date: dateKey(start),
    end_date: dateKey(inclusiveEnd),
    start: start.toISOString(),
    end_exclusive: endExclusive.toISOString(),
  };
}

export function useCalendarSources(input: {
  enabled: boolean;
  onEvents: (
    provider: CalendarProviderId,
    range: CalendarRange,
    mode: CalendarTransferMode,
    events: CalendarEvent[],
  ) => void;
  onDisconnected: (provider: CalendarProviderId) => void;
  onConnectionEvent: (
    provider: CalendarProviderId,
    action: "connect" | "sync" | "disconnect",
    success: boolean,
  ) => void;
}): CalendarSourcesController {
  const [statuses, setStatuses] = useState<CalendarConnectionStatus[]>([]);
  const [activity, setActivity] = useState(INITIAL_ACTIVITY);
  const activityRef = useRef(activity);
  activityRef.current = activity;
  const onEventsRef = useRef(input.onEvents);
  onEventsRef.current = input.onEvents;
  const calendarOperationBoundaryRef = useRef<ConnectorResetBoundary | null>(null);
  if (calendarOperationBoundaryRef.current === null) {
    calendarOperationBoundaryRef.current = createConnectorResetBoundary();
  }
  const calendarOperationBoundary = calendarOperationBoundaryRef.current;
  const quiesceForReset = useCallback(
    () => calendarOperationBoundary.quiesce(),
    [calendarOperationBoundary],
  );

  const setProviderActivity = useCallback((provider: CalendarProviderId, update: Partial<CalendarProviderActivity>) => {
    setActivity((current) => ({
      ...current,
      [provider]: { ...current[provider], ...update },
    }));
  }, []);

  const refreshStatuses = useCallback(async () => {
    const operation = calendarOperationBoundary.begin();
    if (!operation) return;
    try {
      if (!input.enabled) {
        setStatuses([
          { provider: "outlook", available: false, connected: false, detail: "Live sync is available in the macOS app." },
          { provider: "google", available: false, connected: false, detail: "Live sync is available in the macOS app." },
          { provider: "apple", available: false, connected: false, detail: "Live sync is available in the macOS app." },
        ]);
        return;
      }
      const next = await invoke<CalendarConnectionStatus[]>("calendar_source_statuses");
      if (!operation.isCurrent()) return;
      setStatuses(next);
    } catch (error) {
      if (!operation.isCurrent()) return;
      throw error;
    } finally {
      operation.finish();
    }
  }, [calendarOperationBoundary, input.enabled]);

  const applyNativeEvents = useCallback(async (
    command: "connect_calendar_source" | "sync_calendar_source",
    provider: CalendarProviderId,
    range: CalendarRange,
  ) => {
    const operation = calendarOperationBoundary.begin();
    if (!operation) return;
    setProviderActivity(provider, {
      phase: command === "connect_calendar_source" ? "connecting" : "syncing",
      message: null,
    });
    try {
      const events = await invoke<CalendarEvent[]>(command, {
        request: { provider, start: range.start, endExclusive: range.end_exclusive },
      });
      if (!operation.isCurrent()) return;
      onEventsRef.current(provider, range, "live_sync", events);
      if (command === "connect_calendar_source") input.onConnectionEvent(provider, "connect", true);
      setProviderActivity(provider, {
        phase: "idle",
        message: null,
        last_synced_at: new Date().toISOString(),
      });
      if (command === "connect_calendar_source") {
        await refreshStatuses();
        if (!operation.isCurrent()) return;
      }
    } catch (error) {
      if (!operation.isCurrent()) return;
      const message = error instanceof Error ? error.message : String(error);
      setProviderActivity(provider, { phase: "error", message });
      input.onConnectionEvent(provider, command === "connect_calendar_source" ? "connect" : "sync", false);
      throw error;
    } finally {
      operation.finish();
    }
  }, [calendarOperationBoundary, input, refreshStatuses, setProviderActivity]);

  const connect = useCallback((provider: CalendarProviderId, range: CalendarRange) => (
    applyNativeEvents("connect_calendar_source", provider, range)
  ), [applyNativeEvents]);

  const sync = useCallback((provider: CalendarProviderId, range: CalendarRange) => (
    applyNativeEvents("sync_calendar_source", provider, range)
  ), [applyNativeEvents]);

  const disconnect = useCallback(async (provider: CalendarProviderId) => {
    const operation = calendarOperationBoundary.begin();
    if (!operation) return;
    try {
      await invoke("disconnect_calendar_source", { provider });
      if (!operation.isCurrent()) return;
      input.onDisconnected(provider);
      setProviderActivity(provider, { phase: "idle", message: null, last_synced_at: null });
      await refreshStatuses();
      if (!operation.isCurrent()) return;
    } catch (error) {
      if (!operation.isCurrent()) return;
      const message = error instanceof Error ? error.message : String(error);
      setProviderActivity(provider, { phase: "error", message });
      input.onConnectionEvent(provider, "disconnect", false);
      throw error;
    } finally {
      operation.finish();
    }
  }, [calendarOperationBoundary, input, refreshStatuses, setProviderActivity]);

  const clearNativeStateForReset = useCallback(async (): Promise<boolean> => {
    await calendarOperationBoundary.quiesce();
    if (!input.enabled) return true;
    const results = await Promise.all(
      (["outlook", "google", "apple"] as CalendarProviderId[]).map((provider) => (
        invoke("disconnect_calendar_source", { provider })
          .then(() => true)
          .catch(() => false)
      )),
    );
    return results.every(Boolean);
  }, [calendarOperationBoundary, input.enabled]);

  const resumeAfterReset = useCallback(() => {
    calendarOperationBoundary.reopen();
    setStatuses([]);
    setActivity(INITIAL_ACTIVITY);
    queueMicrotask(() => void refreshStatuses().catch(() => undefined));
  }, [calendarOperationBoundary, refreshStatuses]);

  useEffect(() => {
    void refreshStatuses().catch(() => undefined);
  }, [refreshStatuses]);

  const connectedKey = statuses
    .filter((status) => status.connected)
    .map((status) => status.provider)
    .sort()
    .join(",");

  useEffect(() => {
    if (!input.enabled || !connectedKey) return;
    const connected = connectedKey.split(",") as CalendarProviderId[];
    if (connected.length === 0) return;
    const run = () => {
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      const range = rollingLiveRange();
      connected.forEach((provider) => {
        if (activityRef.current[provider].phase === "idle") void sync(provider, range).catch(() => undefined);
      });
    };
    run();
    const interval = window.setInterval(run, 15 * 60 * 1000);
    window.addEventListener("online", run);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", run);
    };
  }, [connectedKey, input.enabled, sync]);

  return {
    statuses,
    activity,
    refreshStatuses,
    connect,
    sync,
    disconnect,
    quiesceForReset,
    clearNativeStateForReset,
    resumeAfterReset,
  };
}
