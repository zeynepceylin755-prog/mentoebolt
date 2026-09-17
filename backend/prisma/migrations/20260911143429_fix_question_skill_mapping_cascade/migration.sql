-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_QuestionSkillMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "microSkillId" TEXT NOT NULL,
    "relevance" REAL NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "aiConfidence" REAL,
    "mappingSource" TEXT NOT NULL,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuestionSkillMapping_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionSkillMapping_microSkillId_fkey" FOREIGN KEY ("microSkillId") REFERENCES "MicroSkill" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_QuestionSkillMapping" ("aiConfidence", "createdAt", "id", "isPrimary", "mappingSource", "microSkillId", "questionId", "relevance", "reviewed", "updatedAt") SELECT "aiConfidence", "createdAt", "id", "isPrimary", "mappingSource", "microSkillId", "questionId", "relevance", "reviewed", "updatedAt" FROM "QuestionSkillMapping";
DROP TABLE "QuestionSkillMapping";
ALTER TABLE "new_QuestionSkillMapping" RENAME TO "QuestionSkillMapping";
CREATE INDEX "QuestionSkillMapping_questionId_idx" ON "QuestionSkillMapping"("questionId");
CREATE INDEX "QuestionSkillMapping_microSkillId_idx" ON "QuestionSkillMapping"("microSkillId");
CREATE INDEX "QuestionSkillMapping_isPrimary_idx" ON "QuestionSkillMapping"("isPrimary");
CREATE INDEX "QuestionSkillMapping_mappingSource_idx" ON "QuestionSkillMapping"("mappingSource");
CREATE UNIQUE INDEX "QuestionSkillMapping_questionId_microSkillId_key" ON "QuestionSkillMapping"("questionId", "microSkillId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
