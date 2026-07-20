import { NextResponse } from "next/server";

import {
  buildPersonalAgentContext,
  generatePersonalAgentAnswer,
  parsePersonalAgentQuestion,
} from "@/lib/personalAgent";
import { listOwnPersonalReplicas } from "@/lib/personalReplica";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request): Promise<NextResponse> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Send the question as JSON." }, { status: 415 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 2_048) {
    return NextResponse.json({ error: "That question is too large." }, { status: 413 });
  }
  const supabase = await createClient();
  if (!supabase) return NextResponse.json({ error: "Weekform Cloud is not configured." }, { status: 503 });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Your session expired. Sign in again." }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "The question could not be read." }, { status: 400 });
  }
  const question = parsePersonalAgentQuestion(body);
  if (!question) return NextResponse.json({ error: "Enter a question of 600 characters or fewer." }, { status: 400 });

  // Reload under the authenticated user's RLS session. Browser-supplied workload
  // context is never accepted, even though the current replica is rendered there.
  const { replicas, error } = await listOwnPersonalReplicas(supabase);
  if (error) return NextResponse.json({ error: "Your review-safe workload summary could not be loaded." }, { status: 503 });
  const replica = replicas[0]?.payload;
  if (!replica) return NextResponse.json({ error: "No review-safe week is connected yet. Publish one from Weekform for Mac." }, { status: 409 });

  const result = await generatePersonalAgentAnswer(buildPersonalAgentContext(replica), question);
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
