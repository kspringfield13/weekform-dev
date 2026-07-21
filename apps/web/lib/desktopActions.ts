export type DesktopStartTrackingState = {
  status: "idle" | "queued" | "already-tracking" | "unavailable" | "error";
  message: string;
};

export const INITIAL_DESKTOP_START_TRACKING_STATE: DesktopStartTrackingState = {
  status: "idle",
  message: "",
};
