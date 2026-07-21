type DesktopPresenceQueryResult = {
  data: unknown;
  error: unknown;
};

export type DesktopPresenceClient = {
  from(table: "weekform_devices"): {
    select(columns: "id, revoked_at"): {
      is(column: "revoked_at", value: null): {
        limit(count: 1): PromiseLike<DesktopPresenceQueryResult>;
      };
    };
  };
};

export function hasRegisteredDesktop(rows: unknown): boolean {
  return Array.isArray(rows) && rows.some((row) => {
    if (!row || typeof row !== "object") return false;
    const candidate = row as { id?: unknown; revoked_at?: unknown };
    return typeof candidate.id === "string"
      && candidate.id.length > 0
      && candidate.revoked_at === null;
  });
}

/**
 * Uses the signed-in user's RLS-scoped device registry. A registered,
 * unrevoked desktop permits an explicit native-app handoff; absence or query
 * failure stays on the normal download route.
 */
export async function hasOwnRegisteredDesktop(
  client: DesktopPresenceClient,
): Promise<boolean> {
  const { data, error } = await client
    .from("weekform_devices")
    .select("id, revoked_at")
    .is("revoked_at", null)
    .limit(1);

  return !error && hasRegisteredDesktop(data);
}
