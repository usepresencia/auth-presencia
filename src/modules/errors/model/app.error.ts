import type { ErrorCode } from './error-codes';

export class AppError extends Error {
    readonly retryAfterSeconds?: number;

    constructor(
        readonly code: ErrorCode,
        options?: { cause?: unknown; retryAfterSeconds?: number },
    ) {
        super(code, options);
        this.name = 'AppError';
        this.retryAfterSeconds = options?.retryAfterSeconds;
    }
}
