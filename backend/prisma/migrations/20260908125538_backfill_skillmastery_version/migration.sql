-- Backfill SkillMastery version from 0 to 1 for existing records
UPDATE "SkillMastery" SET "version" = 1 WHERE "version" = 0;