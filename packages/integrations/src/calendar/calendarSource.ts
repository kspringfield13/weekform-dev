/**
 * Compatibility entrypoint for the provider-neutral calendar integration.
 *
 * The canonical implementation now lives in `calendarSync.ts` and supports
 * Outlook, Google, and Apple through the same bounded import/live-sync model.
 * Keep this module so older imports do not revive the former OAuth-stub
 * descriptor contract.
 */
export * from "./calendarSync";
