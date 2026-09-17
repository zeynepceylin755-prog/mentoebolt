-- CreateTable
CREATE TABLE "CurriculumVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "grade" INTEGER NOT NULL,
    "subject" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceDocument" TEXT,
    "updateDate" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Theme" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "curriculumVersionId" TEXT NOT NULL,
    "officialCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "lessonHours" INTEGER NOT NULL,
    "sourceOrder" INTEGER NOT NULL,
    "sourceTheme" TEXT,
    "sourceDocument" TEXT,
    "sourcePage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Theme_curriculumVersionId_fkey" FOREIGN KEY ("curriculumVersionId") REFERENCES "CurriculumVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LearningOutcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "themeId" TEXT NOT NULL,
    "officialCode" TEXT NOT NULL,
    "officialText" TEXT NOT NULL,
    "sourceOrder" INTEGER NOT NULL,
    "sourceDocument" TEXT,
    "sourcePage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LearningOutcome_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProcessComponent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "learningOutcomeId" TEXT NOT NULL,
    "officialCode" TEXT NOT NULL,
    "officialText" TEXT NOT NULL,
    "sourceOrder" INTEGER NOT NULL,
    "sourceDocument" TEXT,
    "sourcePage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ProcessComponent_learningOutcomeId_fkey" FOREIGN KEY ("learningOutcomeId") REFERENCES "LearningOutcome" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
