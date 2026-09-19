-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STUDENT',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "emailVerifiedAt" TIMESTAMP(3),
    "verificationToken" TEXT,
    "verificationTokenExpiry" TIMESTAMP(3),
    "resetToken" TEXT,
    "resetTokenExpiry" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "loginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grade" INTEGER NOT NULL DEFAULT 11,
    "school" TEXT,
    "learningStage" TEXT NOT NULL DEFAULT 'DISCOVERY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningSession" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "sessionType" TEXT NOT NULL DEFAULT 'PRACTICE',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "correctAnswers" INTEGER NOT NULL DEFAULT 0,
    "durationSeconds" INTEGER,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "LearningSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningSessionQuestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "answeredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningSessionQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sourceId" TEXT,
    "origin" TEXT,
    "trust" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "sourceReference" TEXT,
    "isFixture" BOOLEAN NOT NULL DEFAULT false,
    "canonicalKey" TEXT,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionOption" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionAttempt" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "sessionId" TEXT,
    "sessionQuestionId" TEXT,
    "assessmentAttemptId" TEXT,
    "answer" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL,
    "timeSpentSeconds" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION,
    "errorType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "instanceId" TEXT,

    CONSTRAINT "QuestionAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorAnalysis" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "errorPatternId" TEXT,
    "errorType" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "relatedSkills" TEXT,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "validationQuestionId" TEXT,
    "validationResult" BOOLEAN,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrorAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SkillMastery" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "microSkillId" TEXT,
    "masteryLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correctAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "trend" TEXT,
    "nextReviewAt" TIMESTAMP(3),
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SkillMastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicMastery" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "masteryLevel" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correctAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicMastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningProgress" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "masteryLevel" DOUBLE PRECISION NOT NULL,
    "attemptsCount" INTEGER NOT NULL,
    "correctCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LearningProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "focusSkillId" TEXT NOT NULL,
    "focusSkillName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "estimatedTimeMinutes" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "actionType" TEXT NOT NULL DEFAULT 'PRACTICE',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "acceptedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "metadata" TEXT,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assessment" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'DIAGNOSTIC',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "skillIds" TEXT,
    "topicIds" TEXT,
    "totalQuestions" INTEGER NOT NULL DEFAULT 0,
    "timeLimitMinutes" INTEGER,
    "passingScore" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Assessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentQuestion" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 1,
    "difficulty" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentAttempt" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "score" DOUBLE PRECISION,
    "maxScore" DOUBLE PRECISION,
    "percentageScore" DOUBLE PRECISION,
    "timeSpentSeconds" INTEGER,
    "answers" TEXT,
    "results" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssessmentResult" (
    "id" TEXT NOT NULL,
    "assessmentAttemptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "topicId" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "percentageScore" DOUBLE PRECISION NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "correctAttempts" INTEGER NOT NULL DEFAULT 0,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AssessmentResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagnosticResult" (
    "id" TEXT NOT NULL,
    "assessmentAttemptId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "overallScore" DOUBLE PRECISION NOT NULL,
    "overallConfidence" DOUBLE PRECISION NOT NULL,
    "summary" TEXT,
    "skillResults" TEXT,
    "topicResults" TEXT,
    "recommendations" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiagnosticResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "replacedByTokenId" TEXT,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "response" TEXT,
    "statusCode" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "metadata" TEXT,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MasteryAudit" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "attemptId" TEXT,
    "previousMastery" DOUBLE PRECISION NOT NULL,
    "newMastery" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MasteryAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumVersion" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceDocument" TEXT,
    "updateDate" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurriculumVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Theme" (
    "id" TEXT NOT NULL,
    "curriculumVersionId" TEXT NOT NULL,
    "officialCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lessonHours" INTEGER NOT NULL,
    "sourceOrder" INTEGER NOT NULL,
    "sourceTheme" TEXT,
    "sourceDocument" TEXT,
    "sourcePage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Theme_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LearningOutcome" (
    "id" TEXT NOT NULL,
    "themeId" TEXT NOT NULL,
    "officialCode" TEXT NOT NULL,
    "officialText" TEXT NOT NULL,
    "sourceOrder" INTEGER NOT NULL,
    "sourceDocument" TEXT,
    "sourcePage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LearningOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessComponent" (
    "id" TEXT NOT NULL,
    "learningOutcomeId" TEXT NOT NULL,
    "officialCode" TEXT NOT NULL,
    "officialText" TEXT NOT NULL,
    "sourceOrder" INTEGER NOT NULL,
    "sourceDocument" TEXT,
    "sourcePage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessComponent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MicroSkill" (
    "id" TEXT NOT NULL,
    "processComponentId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT,
    "difficulty" TEXT,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MicroSkill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorPattern" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "commonWrongAnswers" TEXT,
    "source" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewerId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ErrorPattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ErrorPatternMicroSkill" (
    "errorPatternId" TEXT NOT NULL,
    "microSkillId" TEXT NOT NULL,
    "relevance" DOUBLE PRECISION NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorPatternMicroSkill_pkey" PRIMARY KEY ("errorPatternId","microSkillId")
);

-- CreateTable
CREATE TABLE "QuestionSkillMapping" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "microSkillId" TEXT NOT NULL,
    "relevance" DOUBLE PRECISION NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "aiConfidence" DOUBLE PRECISION,
    "mappingSource" TEXT NOT NULL,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionSkillMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionSource" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "trustCeiling" TEXT NOT NULL,
    "license" TEXT,
    "sourceDocument" TEXT,
    "externalRef" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionIngestion" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT,
    "ingestedByUserId" TEXT,
    "ingestMethod" TEXT NOT NULL,
    "originalAssetRef" TEXT,
    "originalAssetMimeType" TEXT,
    "originalAssetSizeBytes" INTEGER,
    "rawExtractedText" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "extractionFailed" BOOLEAN NOT NULL DEFAULT false,
    "extractionErrorMessage" TEXT,
    "normalizedText" TEXT,
    "normalizedExpression" TEXT,
    "parsingConfidence" DOUBLE PRECISION,
    "state" TEXT NOT NULL DEFAULT 'INGESTED',
    "requiresReview" BOOLEAN NOT NULL DEFAULT true,
    "reviewNotes" TEXT,
    "resultingQuestionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionIngestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestionInstance" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "ingestionId" TEXT,
    "studentId" TEXT,
    "assetRef" TEXT,
    "assetMimeType" TEXT,
    "assetHash" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuestionInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumCandidate" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "method" TEXT NOT NULL,
    "rationale" TEXT,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "reviewedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurriculumCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "StudentProfile_userId_key" ON "StudentProfile"("userId");

-- CreateIndex
CREATE INDEX "StudentProfile_userId_idx" ON "StudentProfile"("userId");

-- CreateIndex
CREATE INDEX "StudentProfile_grade_idx" ON "StudentProfile"("grade");

-- CreateIndex
CREATE INDEX "StudentProfile_learningStage_idx" ON "StudentProfile"("learningStage");

-- CreateIndex
CREATE INDEX "LearningSession_studentId_idx" ON "LearningSession"("studentId");

-- CreateIndex
CREATE INDEX "LearningSession_status_idx" ON "LearningSession"("status");

-- CreateIndex
CREATE INDEX "LearningSession_sessionType_idx" ON "LearningSession"("sessionType");

-- CreateIndex
CREATE INDEX "LearningSession_startedAt_idx" ON "LearningSession"("startedAt");

-- CreateIndex
CREATE INDEX "LearningSession_expiresAt_idx" ON "LearningSession"("expiresAt");

-- CreateIndex
CREATE INDEX "LearningSessionQuestion_sessionId_idx" ON "LearningSessionQuestion"("sessionId");

-- CreateIndex
CREATE INDEX "LearningSessionQuestion_questionId_idx" ON "LearningSessionQuestion"("questionId");

-- CreateIndex
CREATE INDEX "LearningSessionQuestion_status_idx" ON "LearningSessionQuestion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "LearningSessionQuestion_sessionId_questionId_key" ON "LearningSessionQuestion"("sessionId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "Question_canonicalKey_key" ON "Question"("canonicalKey");

-- CreateIndex
CREATE INDEX "Question_skillId_idx" ON "Question"("skillId");

-- CreateIndex
CREATE INDEX "Question_learningObjectiveId_idx" ON "Question"("learningObjectiveId");

-- CreateIndex
CREATE INDEX "Question_difficulty_idx" ON "Question"("difficulty");

-- CreateIndex
CREATE INDEX "Question_isActive_idx" ON "Question"("isActive");

-- CreateIndex
CREATE INDEX "Question_sourceId_idx" ON "Question"("sourceId");

-- CreateIndex
CREATE INDEX "Question_trust_idx" ON "Question"("trust");

-- CreateIndex
CREATE INDEX "Question_isFixture_idx" ON "Question"("isFixture");

-- CreateIndex
CREATE INDEX "QuestionOption_questionId_idx" ON "QuestionOption"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionOption_questionId_order_key" ON "QuestionOption"("questionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionAttempt_sessionQuestionId_key" ON "QuestionAttempt"("sessionQuestionId");

-- CreateIndex
CREATE INDEX "QuestionAttempt_studentId_idx" ON "QuestionAttempt"("studentId");

-- CreateIndex
CREATE INDEX "QuestionAttempt_questionId_idx" ON "QuestionAttempt"("questionId");

-- CreateIndex
CREATE INDEX "QuestionAttempt_sessionId_idx" ON "QuestionAttempt"("sessionId");

-- CreateIndex
CREATE INDEX "QuestionAttempt_assessmentAttemptId_idx" ON "QuestionAttempt"("assessmentAttemptId");

-- CreateIndex
CREATE INDEX "QuestionAttempt_isCorrect_idx" ON "QuestionAttempt"("isCorrect");

-- CreateIndex
CREATE INDEX "QuestionAttempt_createdAt_idx" ON "QuestionAttempt"("createdAt");

-- CreateIndex
CREATE INDEX "QuestionAttempt_status_idx" ON "QuestionAttempt"("status");

-- CreateIndex
CREATE INDEX "QuestionAttempt_errorType_idx" ON "QuestionAttempt"("errorType");

-- CreateIndex
CREATE INDEX "QuestionAttempt_instanceId_idx" ON "QuestionAttempt"("instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestionAttempt_id_sessionId_key" ON "QuestionAttempt"("id", "sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ErrorAnalysis_attemptId_key" ON "ErrorAnalysis"("attemptId");

-- CreateIndex
CREATE INDEX "ErrorAnalysis_studentId_idx" ON "ErrorAnalysis"("studentId");

-- CreateIndex
CREATE INDEX "ErrorAnalysis_attemptId_idx" ON "ErrorAnalysis"("attemptId");

-- CreateIndex
CREATE INDEX "ErrorAnalysis_errorPatternId_idx" ON "ErrorAnalysis"("errorPatternId");

-- CreateIndex
CREATE INDEX "ErrorAnalysis_errorType_idx" ON "ErrorAnalysis"("errorType");

-- CreateIndex
CREATE INDEX "ErrorAnalysis_validated_idx" ON "ErrorAnalysis"("validated");

-- CreateIndex
CREATE INDEX "ErrorAnalysis_createdAt_idx" ON "ErrorAnalysis"("createdAt");

-- CreateIndex
CREATE INDEX "SkillMastery_studentId_idx" ON "SkillMastery"("studentId");

-- CreateIndex
CREATE INDEX "SkillMastery_skillId_idx" ON "SkillMastery"("skillId");

-- CreateIndex
CREATE INDEX "SkillMastery_microSkillId_idx" ON "SkillMastery"("microSkillId");

-- CreateIndex
CREATE INDEX "SkillMastery_masteryLevel_idx" ON "SkillMastery"("masteryLevel");

-- CreateIndex
CREATE INDEX "SkillMastery_confidence_idx" ON "SkillMastery"("confidence");

-- CreateIndex
CREATE INDEX "SkillMastery_nextReviewAt_idx" ON "SkillMastery"("nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "SkillMastery_studentId_skillId_key" ON "SkillMastery"("studentId", "skillId");

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
CREATE INDEX "Recommendation_studentId_idx" ON "Recommendation"("studentId");

-- CreateIndex
CREATE INDEX "Recommendation_status_idx" ON "Recommendation"("status");

-- CreateIndex
CREATE INDEX "Recommendation_priority_idx" ON "Recommendation"("priority");

-- CreateIndex
CREATE INDEX "Recommendation_createdAt_idx" ON "Recommendation"("createdAt");

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
CREATE UNIQUE INDEX "RefreshToken_token_key" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

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
CREATE UNIQUE INDEX "CurriculumVersion_code_key" ON "CurriculumVersion"("code");

-- CreateIndex
CREATE INDEX "CurriculumVersion_grade_idx" ON "CurriculumVersion"("grade");

-- CreateIndex
CREATE INDEX "CurriculumVersion_subject_idx" ON "CurriculumVersion"("subject");

-- CreateIndex
CREATE INDEX "CurriculumVersion_isActive_idx" ON "CurriculumVersion"("isActive");

-- CreateIndex
CREATE INDEX "Theme_curriculumVersionId_idx" ON "Theme"("curriculumVersionId");

-- CreateIndex
CREATE INDEX "Theme_officialCode_idx" ON "Theme"("officialCode");

-- CreateIndex
CREATE INDEX "Theme_sourceOrder_idx" ON "Theme"("sourceOrder");

-- CreateIndex
CREATE UNIQUE INDEX "Theme_curriculumVersionId_officialCode_key" ON "Theme"("curriculumVersionId", "officialCode");

-- CreateIndex
CREATE INDEX "LearningOutcome_themeId_idx" ON "LearningOutcome"("themeId");

-- CreateIndex
CREATE INDEX "LearningOutcome_officialCode_idx" ON "LearningOutcome"("officialCode");

-- CreateIndex
CREATE INDEX "LearningOutcome_sourceOrder_idx" ON "LearningOutcome"("sourceOrder");

-- CreateIndex
CREATE UNIQUE INDEX "LearningOutcome_themeId_officialCode_key" ON "LearningOutcome"("themeId", "officialCode");

-- CreateIndex
CREATE INDEX "ProcessComponent_learningOutcomeId_idx" ON "ProcessComponent"("learningOutcomeId");

-- CreateIndex
CREATE INDEX "ProcessComponent_officialCode_idx" ON "ProcessComponent"("officialCode");

-- CreateIndex
CREATE INDEX "ProcessComponent_sourceOrder_idx" ON "ProcessComponent"("sourceOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessComponent_learningOutcomeId_officialCode_key" ON "ProcessComponent"("learningOutcomeId", "officialCode");

-- CreateIndex
CREATE UNIQUE INDEX "MicroSkill_code_key" ON "MicroSkill"("code");

-- CreateIndex
CREATE INDEX "MicroSkill_processComponentId_idx" ON "MicroSkill"("processComponentId");

-- CreateIndex
CREATE INDEX "MicroSkill_code_idx" ON "MicroSkill"("code");

-- CreateIndex
CREATE INDEX "MicroSkill_category_idx" ON "MicroSkill"("category");

-- CreateIndex
CREATE INDEX "MicroSkill_difficulty_idx" ON "MicroSkill"("difficulty");

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

-- AddForeignKey
ALTER TABLE "StudentProfile" ADD CONSTRAINT "StudentProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSession" ADD CONSTRAINT "LearningSession_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSessionQuestion" ADD CONSTRAINT "LearningSessionQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningSessionQuestion" ADD CONSTRAINT "LearningSessionQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LearningSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "QuestionSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionOption" ADD CONSTRAINT "QuestionOption_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "QuestionInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "LearningSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_sessionQuestionId_fkey" FOREIGN KEY ("sessionQuestionId") REFERENCES "LearningSessionQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionAttempt" ADD CONSTRAINT "QuestionAttempt_assessmentAttemptId_fkey" FOREIGN KEY ("assessmentAttemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorAnalysis" ADD CONSTRAINT "ErrorAnalysis_errorPatternId_fkey" FOREIGN KEY ("errorPatternId") REFERENCES "ErrorPattern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorAnalysis" ADD CONSTRAINT "ErrorAnalysis_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuestionAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorAnalysis" ADD CONSTRAINT "ErrorAnalysis_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillMastery" ADD CONSTRAINT "SkillMastery_microSkillId_fkey" FOREIGN KEY ("microSkillId") REFERENCES "MicroSkill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillMastery" ADD CONSTRAINT "SkillMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicMastery" ADD CONSTRAINT "TopicMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningProgress" ADD CONSTRAINT "LearningProgress_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentQuestion" ADD CONSTRAINT "AssessmentQuestion_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentQuestion" ADD CONSTRAINT "AssessmentQuestion_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "Assessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentAttempt" ADD CONSTRAINT "AssessmentAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResult" ADD CONSTRAINT "AssessmentResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssessmentResult" ADD CONSTRAINT "AssessmentResult_assessmentAttemptId_fkey" FOREIGN KEY ("assessmentAttemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticResult" ADD CONSTRAINT "DiagnosticResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiagnosticResult" ADD CONSTRAINT "DiagnosticResult_assessmentAttemptId_fkey" FOREIGN KEY ("assessmentAttemptId") REFERENCES "AssessmentAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasteryAudit" ADD CONSTRAINT "MasteryAudit_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "QuestionAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MasteryAudit" ADD CONSTRAINT "MasteryAudit_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Theme" ADD CONSTRAINT "Theme_curriculumVersionId_fkey" FOREIGN KEY ("curriculumVersionId") REFERENCES "CurriculumVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningOutcome" ADD CONSTRAINT "LearningOutcome_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessComponent" ADD CONSTRAINT "ProcessComponent_learningOutcomeId_fkey" FOREIGN KEY ("learningOutcomeId") REFERENCES "LearningOutcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MicroSkill" ADD CONSTRAINT "MicroSkill_processComponentId_fkey" FOREIGN KEY ("processComponentId") REFERENCES "ProcessComponent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorPatternMicroSkill" ADD CONSTRAINT "ErrorPatternMicroSkill_microSkillId_fkey" FOREIGN KEY ("microSkillId") REFERENCES "MicroSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ErrorPatternMicroSkill" ADD CONSTRAINT "ErrorPatternMicroSkill_errorPatternId_fkey" FOREIGN KEY ("errorPatternId") REFERENCES "ErrorPattern"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSkillMapping" ADD CONSTRAINT "QuestionSkillMapping_microSkillId_fkey" FOREIGN KEY ("microSkillId") REFERENCES "MicroSkill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionSkillMapping" ADD CONSTRAINT "QuestionSkillMapping_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionIngestion" ADD CONSTRAINT "QuestionIngestion_resultingQuestionId_fkey" FOREIGN KEY ("resultingQuestionId") REFERENCES "Question"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionIngestion" ADD CONSTRAINT "QuestionIngestion_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "QuestionSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionInstance" ADD CONSTRAINT "QuestionInstance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "StudentProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionInstance" ADD CONSTRAINT "QuestionInstance_ingestionId_fkey" FOREIGN KEY ("ingestionId") REFERENCES "QuestionIngestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestionInstance" ADD CONSTRAINT "QuestionInstance_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumCandidate" ADD CONSTRAINT "CurriculumCandidate_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "Question"("id") ON DELETE CASCADE ON UPDATE CASCADE;

