-- CreateTable
CREATE TABLE "QuestionSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "trustCeiling" TEXT NOT NULL,
    "license" TEXT,
    "sourceDocument" TEXT,
    "externalRef" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "QuestionIngestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceId" TEXT,
    "ingestedByUserId" TEXT,
    "ingestMethod" TEXT NOT NULL,
    "originalAssetRef" TEXT,
    "originalAssetMimeType" TEXT,
    "originalAssetSizeBytes" INTEGER,
    "rawExtractedText" TEXT,
    "ocrConfidence" REAL,
    "extractionFailed" BOOLEAN NOT NULL DEFAULT false,
    "extractionErrorMessage" TEXT,
    "normalizedText" TEXT,
    "normalizedExpression" TEXT,
    "parsingConfidence" REAL,
    "state" TEXT NOT NULL DEFAULT 'INGESTED',
    "requiresReview" BOOLEAN NOT NULL DEFAULT true,
    "reviewNotes" TEXT,
    "resultingQuestionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuestionIngestion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "QuestionSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "QuestionIngestion_resultingQuestionId_fkey" FOREIGN KEY ("resultingQuestionId") REFERENCES "Question" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QuestionInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "ingestionId" TEXT,
    "studentId" TEXT,
    "assetRef" TEXT,
    "assetMimeType" TEXT,
    "assetHash" TEXT,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "QuestionInstance_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionInstance_ingestionId_fkey" FOREIGN KEY ("ingestionId") REFERENCES "QuestionIngestion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "QuestionInstance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CurriculumCandidate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "questionId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "method" TEXT NOT NULL,
    "rationale" TEXT,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CurriculumCandidate_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Question" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'MULTIPLE_CHOICE',
    "difficulty" INTEGER NOT NULL DEFAULT 1,
    "skillId" TEXT NOT NULL,
    "learningObjectiveId" TEXT,
    "correctAnswer" TEXT NOT NULL,
    "explanation" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "exposureCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sourceId" TEXT,
    "origin" TEXT,
    "trust" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "sourceReference" TEXT,
    "isFixture" BOOLEAN NOT NULL DEFAULT false,
    "canonicalKey" TEXT,
    CONSTRAINT "Question_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "QuestionSource" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Question" ("content", "correctAnswer", "createdAt", "difficulty", "explanation", "exposureCount", "id", "isActive", "learningObjectiveId", "metadata", "skillId", "type", "updatedAt") SELECT "content", "correctAnswer", "createdAt", "difficulty", "explanation", "exposureCount", "id", "isActive", "learningObjectiveId", "metadata", "skillId", "type", "updatedAt" FROM "Question";
DROP TABLE "Question";
ALTER TABLE "new_Question" RENAME TO "Question";
CREATE UNIQUE INDEX "Question_canonicalKey_key" ON "Question"("canonicalKey");
CREATE INDEX "Question_skillId_idx" ON "Question"("skillId");
CREATE INDEX "Question_learningObjectiveId_idx" ON "Question"("learningObjectiveId");
CREATE INDEX "Question_difficulty_idx" ON "Question"("difficulty");
CREATE INDEX "Question_isActive_idx" ON "Question"("isActive");
CREATE INDEX "Question_sourceId_idx" ON "Question"("sourceId");
CREATE INDEX "Question_trust_idx" ON "Question"("trust");
CREATE INDEX "Question_isFixture_idx" ON "Question"("isFixture");
CREATE TABLE "new_QuestionAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "sessionId" TEXT,
    "sessionQuestionId" TEXT,
    "assessmentAttemptId" TEXT,
    "answer" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "timeSpentSeconds" INTEGER NOT NULL,
    "confidence" REAL,
    "errorType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "validatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "instanceId" TEXT,
    CONSTRAINT "QuestionAttempt_assessmentAttemptId_fkey" FOREIGN KEY ("assessmentAttemptId") REFERENCES "AssessmentAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_sessionQuestionId_fkey" FOREIGN KEY ("sessionQuestionId") REFERENCES "LearningSessionQuestion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LearningSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "QuestionInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_QuestionAttempt" ("answer", "assessmentAttemptId", "confidence", "createdAt", "errorType", "id", "isCorrect", "metadata", "questionId", "sessionId", "sessionQuestionId", "status", "studentId", "timeSpentSeconds", "updatedAt", "validatedAt") SELECT "answer", "assessmentAttemptId", "confidence", "createdAt", "errorType", "id", "isCorrect", "metadata", "questionId", "sessionId", "sessionQuestionId", "status", "studentId", "timeSpentSeconds", "updatedAt", "validatedAt" FROM "QuestionAttempt";
DROP TABLE "QuestionAttempt";
ALTER TABLE "new_QuestionAttempt" RENAME TO "QuestionAttempt";
CREATE UNIQUE INDEX "QuestionAttempt_sessionQuestionId_key" ON "QuestionAttempt"("sessionQuestionId");
CREATE INDEX "QuestionAttempt_studentId_idx" ON "QuestionAttempt"("studentId");
CREATE INDEX "QuestionAttempt_questionId_idx" ON "QuestionAttempt"("questionId");
CREATE INDEX "QuestionAttempt_sessionId_idx" ON "QuestionAttempt"("sessionId");
CREATE INDEX "QuestionAttempt_assessmentAttemptId_idx" ON "QuestionAttempt"("assessmentAttemptId");
CREATE INDEX "QuestionAttempt_isCorrect_idx" ON "QuestionAttempt"("isCorrect");
CREATE INDEX "QuestionAttempt_createdAt_idx" ON "QuestionAttempt"("createdAt");
CREATE INDEX "QuestionAttempt_status_idx" ON "QuestionAttempt"("status");
CREATE INDEX "QuestionAttempt_errorType_idx" ON "QuestionAttempt"("errorType");
CREATE INDEX "QuestionAttempt_instanceId_idx" ON "QuestionAttempt"("instanceId");
CREATE UNIQUE INDEX "QuestionAttempt_id_sessionId_key" ON "QuestionAttempt"("id", "sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "QuestionSource_code_key" ON "QuestionSource"("code");

-- CreateIndex
CREATE INDEX "QuestionSource_origin_idx" ON "QuestionSource"("origin");

-- CreateIndex
CREATE INDEX "QuestionSource_isActive_idx" ON "QuestionSource"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionIngestion_resultingQuestionId_key" ON "QuestionIngestion"("resultingQuestionId");

-- CreateIndex
CREATE INDEX "QuestionIngestion_state_idx" ON "QuestionIngestion"("state");

-- CreateIndex
CREATE INDEX "QuestionIngestion_ingestedByUserId_idx" ON "QuestionIngestion"("ingestedByUserId");

-- CreateIndex
CREATE INDEX "QuestionIngestion_sourceId_idx" ON "QuestionIngestion"("sourceId");

-- CreateIndex
CREATE INDEX "QuestionIngestion_requiresReview_idx" ON "QuestionIngestion"("requiresReview");

-- CreateIndex
CREATE INDEX "QuestionIngestion_createdAt_idx" ON "QuestionIngestion"("createdAt");

-- CreateIndex
CREATE INDEX "QuestionInstance_questionId_idx" ON "QuestionInstance"("questionId");

-- CreateIndex
CREATE INDEX "QuestionInstance_studentId_idx" ON "QuestionInstance"("studentId");

-- CreateIndex
CREATE INDEX "QuestionInstance_ingestionId_idx" ON "QuestionInstance"("ingestionId");

-- CreateIndex
CREATE INDEX "QuestionInstance_assetHash_idx" ON "QuestionInstance"("assetHash");

-- CreateIndex
CREATE INDEX "QuestionInstance_uploadedAt_idx" ON "QuestionInstance"("uploadedAt");

-- CreateIndex
CREATE INDEX "CurriculumCandidate_questionId_idx" ON "CurriculumCandidate"("questionId");

-- CreateIndex
CREATE INDEX "CurriculumCandidate_level_targetId_idx" ON "CurriculumCandidate"("level", "targetId");

-- CreateIndex
CREATE INDEX "CurriculumCandidate_decision_idx" ON "CurriculumCandidate"("decision");

-- CreateIndex
CREATE INDEX "CurriculumCandidate_confidence_idx" ON "CurriculumCandidate"("confidence");

-- CreateIndex
CREATE INDEX "CurriculumCandidate_reviewed_idx" ON "CurriculumCandidate"("reviewed");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumCandidate_questionId_level_targetId_key" ON "CurriculumCandidate"("questionId", "level", "targetId");
