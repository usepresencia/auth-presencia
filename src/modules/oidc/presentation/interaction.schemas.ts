import { z } from 'zod';

const email = z.email().max(320);

export const loginSchema = z.strictObject({ email, password: z.string().min(1).max(1024) });
export const passwordResetSchema = z.strictObject({ email });
