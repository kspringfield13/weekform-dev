/**
 * Shared shape for the invite-creation action state. Lives outside the
 * "use server" module because server-action files may only export async
 * functions.
 */

export interface InviteActionState {
  status: "idle" | "success" | "error";
  message: string | null;
  inviteUrl: string | null;
  email: string | null;
}

export const INITIAL_INVITE_STATE: InviteActionState = {
  status: "idle",
  message: null,
  inviteUrl: null,
  email: null,
};
