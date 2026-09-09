-- Performance indexes for critical queries

-- User queries
CREATE INDEX IF NOT EXISTS idx_user_email ON "User"(email);
CREATE INDEX IF NOT EXISTS idx_user_role ON "User"(role);

-- Student queries
CREATE INDEX IF NOT EXISTS idx_student_user_id ON "StudentProfile"(userId);
CREATE INDEX IF NOT EXISTS idx_student_grade ON "StudentProfile"(grade);

-- Question attempts
CREATE INDEX IF NOT EXISTS idx_attempt_student_question ON "QuestionAttempt"(studentId, questionId);
CREATE INDEX IF NOT EXISTS idx_attempt_student_created ON "QuestionAttempt"(studentId, createdAt DESC);
CREATE INDEX IF NOT EXISTS idx_attempt_correct ON "QuestionAttempt"(isCorrect);

-- Skill mastery
CREATE INDEX IF NOT EXISTS idx_mastery_student_skill ON "SkillMastery"(studentId, skillId);
CREATE INDEX IF NOT EXISTS idx_mastery_level ON "SkillMastery"(masteryLevel DESC);
CREATE INDEX IF NOT EXISTS idx_mastery_review ON "SkillMastery"(nextReviewAt);

-- Learning sessions
CREATE INDEX IF NOT EXISTS idx_session_student_status ON "LearningSession"(studentId, status);
CREATE INDEX IF NOT EXISTS idx_session_started ON "LearningSession"(startedAt DESC);

-- Learning progress
CREATE INDEX IF NOT EXISTS idx_progress_student_skill ON "LearningProgress"(studentId, skillId);
CREATE INDEX IF NOT EXISTS idx_progress_date ON "LearningProgress"(date DESC);

-- Recommendations
CREATE INDEX IF NOT EXISTS idx_recommendation_student ON "Recommendation"(studentId, status);
CREATE INDEX IF NOT EXISTS idx_recommendation_priority ON "Recommendation"(priority DESC);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_attempt_student_correct ON "QuestionAttempt"(studentId, isCorrect);
CREATE INDEX IF NOT EXISTS idx_mastery_student_level ON "SkillMastery"(studentId, masteryLevel DESC);
