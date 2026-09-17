-- CreateTable
CREATE TABLE "MicroSkill" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "processComponentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "difficulty" INTEGER,
    "source" TEXT NOT NULL,
    "confidence" REAL,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MicroSkill_processComponentId_fkey" FOREIGN KEY ("processComponentId") REFERENCES "ProcessComponent" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ErrorPattern" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "commonWrongAnswers" TEXT,
    "source" TEXT NOT NULL,
    "confidence" REAL,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ErrorPatternMicroSkill" (
    "errorPatternId" TEXT NOT NULL,
    "microSkillId" TEXT NOT NULL,
    "relevance" REAL NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("errorPatternId", "microSkillId"),
    CONSTRAINT "ErrorPatternMicroSkill_errorPatternId_fkey" FOREIGN KEY ("errorPatternId") REFERENCES "ErrorPattern" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ErrorPatternMicroSkill_microSkillId_fkey" FOREIGN KEY ("microSkillId") REFERENCES "MicroSkill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionSkillMapping" (
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
    CONSTRAINT "QuestionSkillMapping_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionSkillMapping_microSkillId_fkey" FOREIGN KEY ("microSkillId") REFERENCES "MicroSkill" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ErrorAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "errorPatternId" TEXT,
    "errorType" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "relatedSkills" TEXT,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "validationQuestionId" TEXT,
    "validationResult" BOOLEAN,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ErrorAnalysis_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ErrorAnalysis_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuestionAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ErrorAnalysis_errorPatternId_fkey" FOREIGN KEY ("errorPatternId") REFERENCES "ErrorPattern" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ErrorAnalysis" ("attemptId", "confidence", "createdAt", "errorType", "hypothesis", "id", "metadata", "relatedSkills", "studentId", "updatedAt", "validated", "validationQuestionId", "validationResult") SELECT "attemptId", "confidence", "createdAt", "errorType", "hypothesis", "id", "metadata", "relatedSkills", "studentId", "updatedAt", "validated", "validationQuestionId", "validationResult" FROM "ErrorAnalysis";
DROP TABLE "ErrorAnalysis";
ALTER TABLE "new_ErrorAnalysis" RENAME TO "ErrorAnalysis";
CREATE UNIQUE INDEX "ErrorAnalysis_attemptId_key" ON "ErrorAnalysis"("attemptId");
CREATE INDEX "ErrorAnalysis_studentId_idx" ON "ErrorAnalysis"("studentId");
CREATE INDEX "ErrorAnalysis_attemptId_idx" ON "ErrorAnalysis"("attemptId");
CREATE INDEX "ErrorAnalysis_errorPatternId_idx" ON "ErrorAnalysis"("errorPatternId");
CREATE INDEX "ErrorAnalysis_errorType_idx" ON "ErrorAnalysis"("errorType");
CREATE INDEX "ErrorAnalysis_validated_idx" ON "ErrorAnalysis"("validated");
CREATE INDEX "ErrorAnalysis_createdAt_idx" ON "ErrorAnalysis"("createdAt");
CREATE TABLE "new_SkillMastery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "microSkillId" TEXT,
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
    CONSTRAINT "SkillMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SkillMastery_microSkillId_fkey" FOREIGN KEY ("microSkillId") REFERENCES "MicroSkill" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_SkillMastery" ("attempts", "confidence", "correctAttempts", "createdAt", "evidenceCount", "id", "lastAttemptAt", "masteryLevel", "nextReviewAt", "skillId", "studentId", "trend", "updatedAt", "version") SELECT "attempts", "confidence", "correctAttempts", "createdAt", "evidenceCount", "id", "lastAttemptAt", "masteryLevel", "nextReviewAt", "skillId", "studentId", "trend", "updatedAt", "version" FROM "SkillMastery";
DROP TABLE "SkillMastery";
ALTER TABLE "new_SkillMastery" RENAME TO "SkillMastery";
CREATE INDEX "SkillMastery_studentId_idx" ON "SkillMastery"("studentId");
CREATE INDEX "SkillMastery_skillId_idx" ON "SkillMastery"("skillId");
CREATE INDEX "SkillMastery_microSkillId_idx" ON "SkillMastery"("microSkillId");
CREATE INDEX "SkillMastery_masteryLevel_idx" ON "SkillMastery"("masteryLevel");
CREATE INDEX "SkillMastery_confidence_idx" ON "SkillMastery"("confidence");
CREATE INDEX "SkillMastery_nextReviewAt_idx" ON "SkillMastery"("nextReviewAt");
CREATE UNIQUE INDEX "SkillMastery_studentId_skillId_key" ON "SkillMastery"("studentId", "skillId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "MicroSkill_code_key" ON "MicroSkill"("code");

-- CreateIndex
CREATE INDEX "MicroSkill_processComponentId_idx" ON "MicroSkill"("processComponentId");

-- CreateIndex
CREATE INDEX "MicroSkill_code_idx" ON "MicroSkill"("code");

-- CreateIndex
CREATE INDEX "MicroSkill_category_idx" ON "MicroSkill"("category");

-- CreateIndex
CREATE INDEX "MicroSkill_source_idx" ON "MicroSkill"("source");

-- CreateIndex
CREATE INDEX "MicroSkill_isActive_idx" ON "MicroSkill"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorPattern_code_key" ON "ErrorPattern"("code");

-- CreateIndex
CREATE INDEX "ErrorPattern_code_idx" ON "ErrorPattern"("code");

-- CreateIndex
CREATE INDEX "ErrorPattern_category_idx" ON "ErrorPattern"("category");

-- CreateIndex
CREATE INDEX "ErrorPattern_severity_idx" ON "ErrorPattern"("severity");

-- CreateIndex
CREATE INDEX "ErrorPattern_source_idx" ON "ErrorPattern"("source");

-- CreateIndex
CREATE INDEX "ErrorPattern_isActive_idx" ON "ErrorPattern"("isActive");

-- CreateIndex
CREATE INDEX "ErrorPatternMicroSkill_microSkillId_idx" ON "ErrorPatternMicroSkill"("microSkillId");

-- CreateIndex
CREATE INDEX "QuestionSkillMapping_questionId_idx" ON "QuestionSkillMapping"("questionId");

-- CreateIndex
CREATE INDEX "QuestionSkillMapping_microSkillId_idx" ON "QuestionSkillMapping"("microSkillId");

-- CreateIndex
CREATE INDEX "QuestionSkillMapping_isPrimary_idx" ON "QuestionSkillMapping"("isPrimary");

-- CreateIndex
CREATE INDEX "QuestionSkillMapping_mappingSource_idx" ON "QuestionSkillMapping"("mappingSource");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionSkillMapping_questionId_microSkillId_key" ON "QuestionSkillMapping"("questionId", "microSkillId");
