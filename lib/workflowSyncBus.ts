/**
 * Tiny event bus so store actions can ask the mounted `useSpaceSync` to flush a
 * pending edit to the DB immediately, instead of waiting out the debounce.
 *
 * Standalone (no imports) to avoid a cycle: `store.ts` and `useSpaceSync.ts`
 * both need this, and they already import each other.
 *
 * Call `requestWorkflowSync()` from *discrete* actions — drop / delete a node,
 * finish a resize, connect an edge. NOT from continuous ones (dragging, typing),
 * which the debounce exists to coalesce.
 */
export const SYNC_NOW_EVENT = "workflow-sync-now";

export function requestWorkflowSync(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SYNC_NOW_EVENT));
}
