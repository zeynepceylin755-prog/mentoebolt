-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MicroSkill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processComponentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "difficulty" TEXT,
    "source" TEXT NOT NULL,
    "confidence" REAL,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MicroSkill_processComponentId_fkey" FOREIGN KEY ("processComponentId") REFERENCES "ProcessComponent" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MicroSkill" ("category", "code", "confidence", "createdAt", "description", "difficulty", "id", "isActive", "name", "processComponentId", "reviewed", "reviewerId", "source", "updatedAt", "version") SELECT "category", "code", "confidence", "createdAt", "description", "difficulty", "id", "isActive", "name", "processComponentId", "reviewed", "reviewerId", "source", "updatedAt", "version" FROM "MicroSkill";
DROP TABLE "MicroSkill";
ALTER TABLE "new_MicroSkill" RENAME TO "MicroSkill";
CREATE UNIQUE INDEX "MicroSkill_code_key" ON "MicroSkill"("code");
CREATE INDEX "MicroSkill_processComponentId_idx" ON "MicroSkill"("processComponentId");
CREATE INDEX "MicroSkill_code_idx" ON "MicroSkill"("code");
CREATE INDEX "MicroSkill_category_idx" ON "MicroSkill"("category");
CREATE INDEX "MicroSkill_difficulty_idx" ON "MicroSkill"("difficulty");
CREATE INDEX "MicroSkill_source_idx" ON "MicroSkill"("source");
CREATE INDEX "MicroSkill_isActive_idx" ON "MicroSkill"("isActive");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
