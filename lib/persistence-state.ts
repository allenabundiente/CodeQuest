type DirtyHandler = () => void;

/**
 * Next bundles instrumentation separately from route code, so module-level
 * state is not shared. Keep the write hook on globalThis or app writes never
 * reach the snapshot scheduler.
 */
type GlobalWithHook = typeof globalThis & {
  __codequestDbDirtyHandler?: { handler: DirtyHandler | null };
};

const store = ((globalThis as GlobalWithHook).__codequestDbDirtyHandler ??= {
  handler: null,
});

/** Register the snapshot scheduler (or clear it during shutdown). */
export function setDbDirtyHandler(next: DirtyHandler | null): void {
  store.handler = next;
}

/** Called after every write through the wrapped database handle. */
export function markDbDirty(): void {
  store.handler?.();
}
