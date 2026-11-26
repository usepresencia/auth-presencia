import type { NextFunction, Request, Response } from 'express';
import { CORRELATION_HEADER, resolveCorrelationId } from '../model/correlation-id';

export function correlationIdMiddleware(
    request: Request,
    response: Response,
    next: NextFunction,
): void {
    const id = resolveCorrelationId(request.headers[CORRELATION_HEADER]);
    request.headers[CORRELATION_HEADER] = id;
    response.setHeader(CORRELATION_HEADER, id);
    next();
}
