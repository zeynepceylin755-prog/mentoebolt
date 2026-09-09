/*
  Warnings:

  - Added the required column `sessionId` to the `QuestionAttempt` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `QuestionAttempt` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "User_resetToken_idx";

-- DropIndex
DROP INDEX "User_verificationToken_idx";

-- AlterTable
ALTER TABLE "Recommendation" ADD COLUMN "metadata" TEXT;

-- CreateTable
CREATE TABLE "LearningSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "sessionType" TEXT NOT NULL DEFAULT 'PRACTICE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "correctAnswers" INTEGER NOT NULL DEFAULT 0,
    "durationSeconds" INTEGER,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningSession_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningSessionQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "answeredAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningSessionQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LearningSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "LearningSessionQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ErrorAnalysis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "attemptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
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
    CONSTRAINT "ErrorAnalysis_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuestionAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ErrorAnalysis_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TopicMastery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "masteryLevel" REAL NOT NULL DEFAULT 0,
    "confidence" REAL NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correctAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TopicMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningProgress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "date" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "masteryLevel" REAL NOT NULL,
    "attemptsCount" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearningProgress_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "correctAnswer" TEXT NOT NULL,
    "explanation" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "exposureCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Question" ("content", "correctAnswer", "createdAt", "difficulty", "explanation", "id", "isActive", "skillId", "type", "updatedAt") SELECT "content", "correctAnswer", "createdAt", "difficulty", "explanation", "id", "isActive", "skillId", "type", "updatedAt" FROM "Question";
DROP TABLE "Question";
ALTER TABLE "new_Question" RENAME TO "Question";
CREATE INDEX "Question_skillId_idx" ON "Question"("skillId");
CREATE INDEX "Question_difficulty_idx" ON "Question"("difficulty");
CREATE INDEX "Question_isActive_idx" ON "Question"("isActive");
CREATE TABLE "new_QuestionAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "sessionQuestionId" TEXT,
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
    CONSTRAINT "QuestionAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LearningSession" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_sessionQuestionId_fkey" FOREIGN KEY ("sessionQuestionId") REFERENCES "LearningSessionQuestion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_QuestionAttempt" ("answer", "createdAt", "errorType", "id", "isCorrect", "questionId", "studentId", "timeSpentSeconds") SELECT "answer", "createdAt", "errorType", "id", "isCorrect", "questionId", "studentId", "timeSpentSeconds" FROM "QuestionAttempt";
DROP TABLE "QuestionAttempt";
ALTER TABLE "new_QuestionAttempt" RENAME TO "QuestionAttempt";
CREATE UNIQUE INDEX "QuestionAttempt_sessionQuestionId_key" ON "QuestionAttempt"("sessionQuestionId");
CREATE INDEX "QuestionAttempt_studentId_idx" ON "QuestionAttempt"("studentId");
CREATE INDEX "QuestionAttempt_questionId_idx" ON "QuestionAttempt"("questionId");
CREATE INDEX "QuestionAttempt_sessionId_idx" ON "QuestionAttempt"("sessionId");
CREATE INDEX "QuestionAttempt_isCorrect_idx" ON "QuestionAttempt"("isCorrect");
CREATE INDEX "QuestionAttempt_createdAt_idx" ON "QuestionAttempt"("createdAt");
CREATE INDEX "QuestionAttempt_status_idx" ON "QuestionAttempt"("status");
CREATE INDEX "QuestionAttempt_errorType_idx" ON "QuestionAttempt"("errorType");
CREATE UNIQUE INDEX "QuestionAttempt_id_sessionId_key" ON "QuestionAttempt"("id", "sessionId");
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SkillMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SkillMastery" ("attempts", "confidence", "correctAttempts", "createdAt", "id", "lastAttemptAt", "masteryLevel", "nextReviewAt", "skillId", "studentId", "trend", "updatedAt") SELECT "attempts", "confidence", "correctAttempts", "createdAt", "id", "lastAttemptAt", "masteryLevel", "nextReviewAt", "skillId", "studentId", "trend", "updatedAt" FROM "SkillMastery";
DROP TABLE "SkillMastery";
ALTER TABLE "new_SkillMastery" RENAME TO "SkillMastery";
CREATE INDEX "SkillMastery_studentId_idx" ON "SkillMastery"("studentId");
CREATE INDEX "SkillMastery_skillId_idx" ON "SkillMastery"("skillId");
CREATE INDEX "SkillMastery_masteryLevel_idx" ON "SkillMastery"("masteryLevel");
CREATE INDEX "SkillMastery_confidence_idx" ON "SkillMastery"("confidence");
CREATE INDEX "SkillMastery_nextReviewAt_idx" ON "SkillMastery"("nextReviewAt");
CREATE UNIQUE INDEX "SkillMastery_studentId_skillId_key" ON "SkillMastery"("studentId", "skillId");
CREATE TABLE "new_StudentProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "grade" INTEGER NOT NULL DEFAULT 11,
    "school" TEXT,
    "learningStage" TEXT NOT NULL DEFAULT 'DISCOVERY',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_StudentProfile" ("createdAt", "grade", "id", "learningStage", "school", "updatedAt", "userId") SELECT "createdAt", "grade", "id", coalesce("learningStage", 'DISCOVERY') AS "learningStage", "school", "updatedAt", "userId" FROM "StudentProfile";
DROP TABLE "StudentProfile";
ALTER TABLE "new_StudentProfile" RENAME TO "StudentProfile";
CREATE UNIQUE INDEX "StudentProfile_userId_key" ON "StudentProfile"("userId");
CREATE INDEX "StudentProfile_userId_idx" ON "StudentProfile"("userId");
CREATE INDEX "StudentProfile_grade_idx" ON "StudentProfile"("grade");
CREATE INDEX "StudentProfile_learningStage_idx" ON "StudentProfile"("learningStage");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "LearningSession_studentId_idx" ON "LearningSession"("studentId");

-- CreateIndex
CREATE INDEX "LearningSession_status_idx" ON "LearningSession"("status");

-- CreateIndex
CREATE INDEX "LearningSession_sessionType_idx" ON "LearningSession"("sessionType");

-- CreateIndex
CREATE INDEX "LearningSession_startedAt_idx" ON "LearningSession"("startedAt");

-- CreateIndex
CREATE INDEX "LearningSessionQuestion_sessionId_idx" ON "LearningSessionQuestion"("sessionId");

-- CreateIndex
CREATE INDEX "LearningSessionQuestion_questionId_idx" ON "LearningSessionQuestion"("questionId");

-- CreateIndex
CREATE INDEX "LearningSessionQuestion_status_idx" ON "LearningSessionQuestion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LearningSessionQuestion_sessionId_questionId_key" ON "LearningSessionQuestion"("sessionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorAnalysis_attemptId_key" ON "ErrorAnalysis"("attemptId");

-- CreateIndex
CREATE INDEX "ErrorAnalysis_studentId_idx" ON "ErrorAnalysis"("studentId");

-- CreateIndex
CREATE INDEX "ErrorAnalysis_attemptId_idx" ON "ErrorAnalysis"("attemptId");

-- CreateIndex
CREATE INDEX "ErrorAnalysis_errorType_idx" ON "ErrorAnalysis"("errorType");

-- CreateIndex
CREATE INDEX "ErrorAnalysis_validated_idx" ON "ErrorAnalysis"("validated");

-- CreateIndex
CREATE INDEX "ErrorAnalysis_createdAt_idx" ON "ErrorAnalysis"("createdAt");

-- CreateIndex
CREATE INDEX "TopicMastery_studentId_idx" ON "TopicMastery"("studentId");

-- CreateIndex
CREATE INDEX "TopicMastery_topicId_idx" ON "TopicMastery"("topicId");

-- CreateIndex
CREATE INDEX "TopicMastery_masteryLevel_idx" ON "TopicMastery"("masteryLevel");

-- CreateIndex
CREATE UNIQUE INDEX "TopicMastery_studentId_topicId_key" ON "TopicMastery"("studentId", "topicId");

-- CreateIndex
CREATE INDEX "LearningProgress_studentId_idx" ON "LearningProgress"("studentId");

-- CreateIndex
CREATE INDEX "LearningProgress_skillId_idx" ON "LearningProgress"("skillId");

-- CreateIndex
CREATE INDEX "LearningProgress_date_idx" ON "LearningProgress"("date");

-- CreateIndex
CREATE UNIQUE INDEX "LearningProgress_studentId_skillId_date_key" ON "LearningProgress"("studentId", "skillId", "date");

-- CreateIndex
CREATE INDEX "Recommendation_createdAt_idx" ON "Recommendation"("createdAt");
