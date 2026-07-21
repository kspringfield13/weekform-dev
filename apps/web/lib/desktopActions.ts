export type DesktopStartTrackingState = {
  status: "idle" | "queued" | "unavailable" | "error";
  message: string;
};

export const INITIAL_DESKTOP_START_TRACKING_STATE: DesktopStartTrackingState = {
  status: "idle",
  message: "",
};
