import { useCallback, useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AuditEvent } from "../../../../packages/domain/src/models";
import { createAuditEvent } from "../lib/audit";
import { getLocalDateKey } from "../lib/date";
import { MAX_PROACTIVE_ALERTS_PER_DAY, MIN_PROACTIVE_ALERT_GAP_MS } from "../lib/constants";
import {
  evaluateProactiveAlerts,
  recordFiredAlert,
  shouldFireOsNotification,
  type ProactiveAlert,
  type ProactiveAlertData,
  type ProactiveAlertRuntime,
  type ProactiveAlertSettings,
} from "../lib/proactiveAlerts";
import { sendOsNotification } from "../services/notify";

// Re-evaluate on a slow cadence so time-based conditions (e.g. the daily cap
// resetting after midnight) get picked up even when the snapshot is unchanged.
// Deliberately far slower than the 5s native capture loop.
const EVAL_INTERVAL_MS = 3 * 60 * 1000;

interface UseProactiveAlertsArgs {
  isDemoMode: boolean;
  data: ProactiveAlertData;
  settings: ProactiveAlertSettings;
  runtime: ProactiveAlertRuntime;
  setRuntime: Dispatch<SetStateAction<ProactiveAlertRuntime>>;
  setAuditEvents: Dispatch<SetStateAction<AuditEvent[]>>;
}

/**
 * Reusable proactive-alert engine. Evaluates the rule set against current state,
 * exposes the active alert for the in-app banner, and fires throttled, audited OS
 * notifications. The banner reflects the live condition; the OS toast is rate
 * limited and de-duplicated so the menu bar stays calm.
 */
export function useProactiveAlerts({
  isDemoMode,
  data,
  settings,
  runtime,
  setRuntime,
  setAuditEvents,
}: UseProactiveAlertsArgs): { activeAlert: ProactiveAlert | null; dismissAlert: () => void } {
  const [activeAlert, setActiveAlert] = useState<ProactiveAlert | null>(null);
  // Signature the user explicitly dismissed; suppressed until the condition shifts.
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);

  const evaluate = useCallback(() => {
    // Inject the real "now" at eval time so clock-based rules stay accurate
    // between renders (the slow interval re-runs this same callback).
    const now = new Date();
    const alert = evaluateProactiveAlerts(
      { ...data, nowHour: now.getHours(), nowDow: now.getDay(), todayKey: getLocalDateKey(now) },
      settings,
    );

    if (!alert || dismissedSignature === alert.signature) {
      setActiveAlert(null);
      return;
    }

    // Update the banner only when the alert identity changes, to avoid churn.
    setActiveAlert((current) =>
      current && current.id === alert.id && current.signature === alert.signature ? current : alert,
    );

    if (isDemoMode) return;

    const todayKey = getLocalDateKey(now);
    if (
      !shouldFireOsNotification(
        alert,
        runtime,
        now.getTime(),
        todayKey,
        MAX_PROACTIVE_ALERTS_PER_DAY,
        MIN_PROACTIVE_ALERT_GAP_MS,
      )
    ) {
      return;
    }

    const nowIso = now.toISOString();
    void sendOsNotification(alert.title, alert.body);
    setRuntime((current) => recordFiredAlert(alert, current, nowIso, todayKey));
    setAuditEvents((current) =>
      [
        ...current,
        createAuditEvent({
          type: "proactive_alert",
          source: "proactive_alerts",
          title: "Proactive alert sent",
          summary: alert.body,
          privacy_level: "derived_only",
          timestamp: nowIso,
          details: {
            rule_id: alert.rule_id,
            severity: alert.severity,
            signature: alert.signature,
            action: alert.action,
            stored_locally: true,
            sent_to_cloud: false,
          },
        }),
      ].slice(-1000),
    );
  }, [data, settings, runtime, isDemoMode, dismissedSignature, setRuntime, setAuditEvents]);

  useEffect(() => {
    evaluate();
  }, [evaluate]);

  useEffect(() => {
    const id = window.setInterval(evaluate, EVAL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [evaluate]);

  const dismissAlert = useCallback(() => {
    setActiveAlert((current) => {
      if (current) setDismissedSignature(current.signature);
      return null;
    });
  }, []);

  return { activeAlert, dismissAlert };
}
