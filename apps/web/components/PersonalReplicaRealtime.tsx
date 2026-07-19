"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { createRealtimeClient } from "@/lib/supabase/browser";

export function PersonalReplicaRealtime({ userId }: { userId: string }) {
  const router = useRouter();
  const [connected, setConnected] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createRealtimeClient();
    if (!supabase) return;
    let active = true;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active || !data.session?.access_token) return;
      supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel(`weekform:user:${userId}`, { config: { private: true } })
        .on("broadcast", { event: "*" }, () => {
          if (!active) return;
          startTransition(() => router.refresh());
        })
        .subscribe((status) => {
          if (active) setConnected(status === "SUBSCRIBED");
        });
    });

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [router, userId]);

  return (
    <div className="status-line" aria-live="polite">
      <span>
        {connected
          ? pending ? "A Mac update arrived — refreshing…" : "Private live updates connected"
          : "Live updates unavailable — 15-second refresh remains active"}
      </span>
      <span>Ephemeral signed-in channel · no browser workload cache</span>
    </div>
  );
}
