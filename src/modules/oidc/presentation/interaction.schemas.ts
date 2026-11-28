import { z } from 'zod';

const email = z.email().max(320);
const password = z.string().min(1).max(1024);

export const loginSchema = z.strictObject({ email, password });
export const passwordResetSchema = z.strictObject({ email });
export const passwordDefinitionSchema = z.strictObject({
    code: z.string().min(1).max(512),
    password,
});
