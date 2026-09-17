export type ReadinessChoice = 'skipped' | 'completed';

const READINESS_STORAGE_PREFIX = 'mentora.readiness.v1';

function storageKey(userId: string): string {
  return `${READINESS_STORAGE_PREFIX}:${userId}`;
}

/**
 * Read only the student's choice to pass the optional first-login intro.
 * Learning results never live in localStorage; those must come from the backend.
 */
export function readReadinessChoice(userId: string | null | undefined): ReadinessChoice | null {
  if (!userId) return null;
  const value = localStorage.getItem(storageKey(userId));
  return value === 'skipped' || value === 'completed' ? value : null;
}

export function saveReadinessChoice(userId: string, choice: ReadinessChoice): void {
  localStorage.setItem(storageKey(userId), choice);
}

export function clearReadinessChoice(userId: string): void {
  localStorage.removeItem(storageKey(userId));
}
