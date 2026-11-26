import type { ErrorCode } from './error-codes';

export class AppError extends Error {
    constructor(
        readonly code: ErrorCode,
        options?: { cause?: unknown },
    ) {
        super(code, options);
        this.name = 'AppError';
    }
}
