/**
 * Client-side coordination for self-initiated page removal operations.
 *
 * When a user removes a shared page from their view, the mutation fires POST /leave
 * which notifies the collab server via pg_notify. Moving an owned page to Trash
 * produces a similar terminal collaboration event.
 * The collab server then sends a revoke event over WebSocket, which CodeMirrorEditor
 * handles by showing a toast + navigating away.
 *
 * Without coordination, the user would see TWO toasts:
 *   1. Generic removal feedback from the collab revoke handler
 *   2. Item-specific feedback from the mutation onSuccess
 *
 * This module lets the entity deletion action signal that a leave or deletion
 * was self-initiated, so CodeMirrorEditor can skip its duplicate toast (the
 * mutation handles feedback).
 *
 * For admin-initiated revokes (admin removes your access while you're on the page),
 * no flag is set, so CodeMirrorEditor shows its toast as before.
 */

const SELF_LEAVE_WINDOW_MS = 5_000;

let selfLeavePageId: string | null = null;
let selfLeaveTimestamp = 0;

/** Signal that a self-initiated leave or deletion is in progress for the given page. */
export function markSelfLeave(pageId: string): void {
  selfLeavePageId = pageId;
  selfLeaveTimestamp = Date.now();
}

/** Clear identity-scoped leave coordination when the active user changes. */
export function resetSelfLeaveState(): void {
  selfLeavePageId = null;
  selfLeaveTimestamp = 0;
}

/**
 * Check whether a revoke event was self-initiated.
 * Returns true once per self-leave (consumes the flag).
 * Returns false for admin-initiated revokes or stale flags.
 */
export function consumeSelfLeave(pageId: string): boolean {
  if (selfLeavePageId === pageId && Date.now() - selfLeaveTimestamp < SELF_LEAVE_WINDOW_MS) {
    resetSelfLeaveState();
    return true;
  }
  return false;
}
