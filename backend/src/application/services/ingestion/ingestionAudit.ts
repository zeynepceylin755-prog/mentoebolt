/**
 * Audit helpers for the ingestion lifecycle.
 *
 * Uses the EXISTING `AuditLog` model — no new audit framework, no schema
 * change. The existing model already provides:
 *   userId, action, entityType, entityId, details (JSON string), createdAt
 *
 * Audit rows are written inside the caller's transaction so that an audited
 * state change and its audit record commit or roll back together.
 */

export const INGESTION_AUDIT_ACTIONS = {
  INGESTION_CREATED: 'INGESTION_CREATED',
  INGESTION_STATE_CHANGED: 'INGESTION_STATE_CHANGED',
  INGESTION_APPROVED: 'INGESTION_APPROVED',
  INGESTION_REJECTED: 'INGESTION_REJECTED',
  TRUST_PROMOTION_ATTEMPT: 'TRUST_PROMOTION_ATTEMPT',
} as const;

export interface AuditEntry {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Write one audit row within an existing Prisma transaction client.
 *
 * Deliberately never throws: auditing must not be able to fail the business
 * operation it describes. A failure is swallowed so the state change still
 * commits.
 */
export async function writeAudit(tx: any, entry: AuditEntry): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        userId: entry.userId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        // Never store raw student content or image bytes here. Only identifiers
        // and state metadata.
        details: entry.details ? JSON.stringify(entry.details) : null,
      },
    });
  } catch {
    // Intentionally ignored — audit must not break the business operation.
  }
}
