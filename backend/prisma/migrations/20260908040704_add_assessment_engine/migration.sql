-- AlterTable
ALTER TABLE "Question" ADD COLUMN "learningObjectiveId" TEXT;

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'DIAGNOSTIC',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "skillIds" TEXT,
    "topicIds" TEXT,
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "timeLimitMinutes" INTEGER,
    "passingScore" REAL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "AssessmentQuestion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,
    "difficulty" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssessmentQuestion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssessmentQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentAttempt" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "studentId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "score" REAL,
    "maxScore" REAL,
    "percentageScore" REAL,
    "timeSpentSeconds" INTEGER,
    "answers" TEXT,
    "results" TEXT,
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssessmentAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssessmentAttempt_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AssessmentResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentAttemptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "topicId" TEXT,
    "score" REAL NOT NULL,
    "maxScore" REAL NOT NULL,
    "percentageScore" REAL NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correctAttempts" INTEGER NOT NULL DEFAULT 0,
    "confidence" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AssessmentResult_assessmentAttemptId_fkey" FOREIGN KEY ("assessmentAttemptId") REFERENCES "AssessmentAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AssessmentResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DiagnosticResult" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assessmentAttemptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "overallScore" REAL NOT NULL,
    "overallConfidence" REAL NOT NULL,
    "summary" TEXT,
    "skillResults" TEXT,
    "topicResults" TEXT,
    "recommendations" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DiagnosticResult_assessmentAttemptId_fkey" FOREIGN KEY ("assessmentAttemptId") REFERENCES "AssessmentAttempt" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DiagnosticResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "QuestionAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LearningSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_sessionQuestionId_fkey" FOREIGN KEY ("sessionQuestionId") REFERENCES "LearningSessionQuestion" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "QuestionAttempt_assessmentAttemptId_fkey" FOREIGN KEY ("assessmentAttemptId") REFERENCES "AssessmentAttempt" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_QuestionAttempt" ("answer", "confidence", "createdAt", "errorType", "id", "isCorrect", "metadata", "questionId", "sessionId", "sessionQuestionId", "status", "studentId", "timeSpentSeconds", "updatedAt", "validatedAt") SELECT "answer", "confidence", "createdAt", "errorType", "id", "isCorrect", "metadata", "questionId", "sessionId", "sessionQuestionId", "status", "studentId", "timeSpentSeconds", "updatedAt", "validatedAt" FROM "QuestionAttempt";
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
CREATE UNIQUE INDEX "QuestionAttempt_id_sessionId_key" ON "QuestionAttempt"("id", "sessionId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Assessment_type_idx" ON "Assessment"("type");

-- CreateIndex
CREATE INDEX "Assessment_status_idx" ON "Assessment"("status");

-- CreateIndex
CREATE INDEX "Assessment_isActive_idx" ON "Assessment"("isActive");

-- CreateIndex
CREATE INDEX "AssessmentQuestion_assessmentId_idx" ON "AssessmentQuestion"("assessmentId");

-- CreateIndex
CREATE INDEX "AssessmentQuestion_questionId_idx" ON "AssessmentQuestion"("questionId");

-- CreateIndex
CREATE INDEX "AssessmentQuestion_order_idx" ON "AssessmentQuestion"("order");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentQuestion_assessmentId_questionId_key" ON "AssessmentQuestion"("assessmentId", "questionId");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_studentId_idx" ON "AssessmentAttempt"("studentId");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_assessmentId_idx" ON "AssessmentAttempt"("assessmentId");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_status_idx" ON "AssessmentAttempt"("status");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_startedAt_idx" ON "AssessmentAttempt"("startedAt");

-- CreateIndex
CREATE INDEX "AssessmentAttempt_completedAt_idx" ON "AssessmentAttempt"("completedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssessmentAttempt_studentId_assessmentId_key" ON "AssessmentAttempt"("studentId", "assessmentId");

-- CreateIndex
CREATE INDEX "AssessmentResult_assessmentAttemptId_idx" ON "AssessmentResult"("assessmentAttemptId");

-- CreateIndex
CREATE INDEX "AssessmentResult_studentId_idx" ON "AssessmentResult"("studentId");

-- CreateIndex
CREATE INDEX "AssessmentResult_skillId_idx" ON "AssessmentResult"("skillId");

-- CreateIndex
CREATE INDEX "AssessmentResult_topicId_idx" ON "AssessmentResult"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "DiagnosticResult_assessmentAttemptId_key" ON "DiagnosticResult"("assessmentAttemptId");

-- CreateIndex
CREATE INDEX "DiagnosticResult_assessmentAttemptId_idx" ON "DiagnosticResult"("assessmentAttemptId");

-- CreateIndex
CREATE INDEX "DiagnosticResult_studentId_idx" ON "DiagnosticResult"("studentId");

-- CreateIndex
CREATE INDEX "Question_learningObjectiveId_idx" ON "Question"("learningObjectiveId");
