-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SkillMastery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "masteryLevel" REAL NOT NULL DEFAULT 0,
    "confidence" REAL NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correctAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "trend" TEXT,
    "nextReviewAt" DATETIME,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SkillMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SkillMastery" ("attempts", "confidence", "correctAttempts", "createdAt", "evidenceCount", "id", "lastAttemptAt", "masteryLevel", "nextReviewAt", "skillId", "studentId", "trend", "updatedAt", "version") SELECT "attempts", "confidence", "correctAttempts", "createdAt", "evidenceCount", "id", "lastAttemptAt", "masteryLevel", "nextReviewAt", "skillId", "studentId", "trend", "updatedAt", "version" FROM "SkillMastery";
DROP TABLE "SkillMastery";
ALTER TABLE "new_SkillMastery" RENAME TO "SkillMastery";
CREATE INDEX "SkillMastery_studentId_idx" ON "SkillMastery"("studentId");
CREATE INDEX "SkillMastery_skillId_idx" ON "SkillMastery"("skillId");
CREATE INDEX "SkillMastery_masteryLevel_idx" ON "SkillMastery"("masteryLevel");
CREATE INDEX "SkillMastery_confidence_idx" ON "SkillMastery"("confidence");
CREATE INDEX "SkillMastery_nextReviewAt_idx" ON "SkillMastery"("nextReviewAt");
CREATE INDEX "SkillMastery_version_idx" ON "SkillMastery"("version");
CREATE UNIQUE INDEX "SkillMastery_studentId_skillId_key" ON "SkillMastery"("studentId", "skillId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
