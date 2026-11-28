import type { Request } from 'express';
import { errors } from 'oidc-provider';
import { z } from 'zod';
import { SignInError } from '../../accounts/model/sign-in.error';
import { AppError } from '../../errors/model/app.error';
import { CORRELATION_HEADER, resolveCorrelationId } from '../../errors/model/correlation-id';
import type { RequestOrigin } from '../application/login.service';

export function parseBody<T>(schema: z.ZodType<T>, request: Request): T {
    const result = request.is('application/json') ? schema.safeParse(request.body) : undefined;
    if (!result?.success) throw new AppError('INVALID_REQUEST');
    return result.data;
}

export const requestOrigin = (request: Request): RequestOrigin => ({
    correlationId: resolveCorrelationId(request.headers[CORRELATION_HEADER]),
    address: request.ip ?? 'unknown',
});

export async function guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof SignInError) throw new AppError(error.code);
        if (error instanceof errors.SessionNotFound) throw new AppError('INTERACTION_EXPIRED');
        throw new AppError('AUTH_UNAVAILABLE', { cause: error });
    }
}
