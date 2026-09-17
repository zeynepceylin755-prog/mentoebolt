/**
 * QuestionSkillMapping vocabulary — mirrors the actual Prisma model
 * `QuestionSkillMapping` (schema.prisma) and the Phase 5D design review:
 *
 *   relevance     Float    — how strongly this MicroSkill relates to the question
 *   isPrimary     Boolean  — PRIMARY (true) vs SECONDARY (false)
 *   aiConfidence  Float?   — the automated model's confidence in THIS mapping
 *   mappingSource String   — provenance of the mapping decision
 *   reviewed      Boolean  — human sign-off flag (the schema has NO reviewedByUserId)
 *
 * As everywhere else in this codebase these stay plain Strings (no Prisma enum);
 * they are validated at the application boundary.
 *
 * IMPORTANT — relevance is NOT aiConfidence:
 *   relevance    = "how related is this MicroSkill to the question?"
 *   aiConfidence = "how sure is the automated classifier that this mapping is right?"
 * They are distinct columns with distinct meanings and are never derived from
 * each other.
 */

/**
 * Allowed `mappingSource` values. `MANUAL_REVIEW` is the documented default.
 *
 * `AI_MAPPED` is the provenance of a mapping produced by the automated question
 * analysis pipeline (Phase 5E -> Phase 5D). It is DISTINCT from `AI`: it names a
 * mapping operation that has not been reviewed by a human, whereas `AI` is the
 * pre-existing generic automated-source value. Both are retained.
 */
export const MAPPING_SOURCES = {
  MANUAL_REVIEW: 'MANUAL_REVIEW',
  AI: 'AI',
  AI_MAPPED: 'AI_MAPPED',
  MEB: 'MEB',
  LICENSED_BANK: 'LICENSED_BANK',
} as const;

export type MappingSource = (typeof MAPPING_SOURCES)[keyof typeof MAPPING_SOURCES];

export const ALL_MAPPING_SOURCES: MappingSource[] = Object.values(MAPPING_SOURCES);

export function isMappingSource(value: string): value is MappingSource {
  return (ALL_MAPPING_SOURCES as string[]).includes(value);
}

/** relevance and aiConfidence both live on [0, 1]. */
export const RELEVANCE_MIN = 0;
export const RELEVANCE_MAX = 1;

export const AI_CONFIDENCE_MIN = 0;
export const AI_CONFIDENCE_MAX = 1;
