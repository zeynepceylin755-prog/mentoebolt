// backend/src/api/validators/studentValidators.ts
import { z } from 'zod';

export const createStudentSchema = z.object({
  email: z.string().email('Invalid email format'),
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  grade: z.number().int().min(1, 'Grade must be at least 1').max(12, 'Grade must be at most 12'),
  school: z.string().optional(),
  password: z.string().min(6, 'Password must be at least 6 characters').optional(),
});

export const updateGradeSchema = z.object({
  grade: z.number().int().min(1, 'Grade must be at least 1').max(12, 'Grade must be at most 12'),
});