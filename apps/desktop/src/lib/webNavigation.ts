export function shouldConsumePendingWebNavigation(
  isTauriRuntime: boolean,
  localHydrationSettled: boolean,
): boolean {
  return isTauriRuntime && localHydrationSettled;
}
