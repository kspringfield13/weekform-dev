"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";

import { createRealtimeClient } from "@/lib/supabase/browser";

export function PersonalReplicaRealtime({ userId }: { userId: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

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
        .subscribe();
    });

    return () => {
      active = false;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [router, userId]);

  return null;
}
