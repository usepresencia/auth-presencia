import { STATUS_CODES } from 'node:http';
import type { Request, Response } from 'express';
import { CORRELATION_HEADER, resolveCorrelationId } from '../model/correlation-id';
import { errorDefinition, type ErrorCode } from '../model/error-codes';

/** Escreve a resposta de erro no formato padrão e devolve o correlation id usado. */
export function sendError(
    request: Request,
    response: Response,
    code: ErrorCode,
    status: number = errorDefinition(code).status,
): string {
    const correlationId = resolveCorrelationId(request.headers[CORRELATION_HEADER]);
    response.status(status).json({
        statusCode: status,
        code,
        message: errorDefinition(code).message,
        error: STATUS_CODES[status],
        correlationId,
    });
    return correlationId;
}
