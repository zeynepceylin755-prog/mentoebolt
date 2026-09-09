-- AlterTable
ALTER TABLE "LearningSession" ADD COLUMN "expiresAt" DATETIME;

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "response" TEXT,
    "statusCode" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "completedAt" DATETIME,
    CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "availableAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    "metadata" TEXT
);

-- CreateTable
CREATE TABLE "MasteryAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "attemptId" TEXT,
    "previousMastery" REAL NOT NULL,
    "newMastery" REAL NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "correlationId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MasteryAudit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MasteryAudit_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuestionAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

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
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SkillMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SkillMastery" ("attempts", "confidence", "correctAttempts", "createdAt", "evidenceCount", "id", "lastAttemptAt", "masteryLevel", "nextReviewAt", "skillId", "studentId", "trend", "updatedAt") SELECT "attempts", "confidence", "correctAttempts", "createdAt", "evidenceCount", "id", "lastAttemptAt", "masteryLevel", "nextReviewAt", "skillId", "studentId", "trend", "updatedAt" FROM "SkillMastery";
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

-- CreateIndex
CREATE INDEX "IdempotencyRecord_key_idx" ON "IdempotencyRecord"("key");

-- CreateIndex
CREATE INDEX "IdempotencyRecord_status_expiresAt_idx" ON "IdempotencyRecord"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyRecord_userId_operation_key_key" ON "IdempotencyRecord"("userId", "operation", "key");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateId_idx" ON "OutboxEvent"("aggregateId");

-- CreateIndex
CREATE INDEX "OutboxEvent_createdAt_idx" ON "OutboxEvent"("createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_processingAt_idx" ON "OutboxEvent"("processingAt");

-- CreateIndex
CREATE INDEX "MasteryAudit_studentId_skillId_idx" ON "MasteryAudit"("studentId", "skillId");

-- CreateIndex
CREATE INDEX "MasteryAudit_createdAt_idx" ON "MasteryAudit"("createdAt");

-- CreateIndex
CREATE INDEX "MasteryAudit_source_idx" ON "MasteryAudit"("source");

-- CreateIndex
CREATE INDEX "MasteryAudit_correlationId_idx" ON "MasteryAudit"("correlationId");

-- CreateIndex
CREATE INDEX "LearningSession_expiresAt_idx" ON "LearningSession"("expiresAt");
