import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    Inject,
    Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { errorName } from '../../../shared/utils/error-name';
import { RecordErrorService } from '../application/record-error.service';
import { AppError } from '../model/app.error';
import { errorDefinition, type ErrorCode } from '../model/error-codes';
import { maskPath } from '../model/error-log';
import { sendError } from './error-response';

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
    400: 'INVALID_REQUEST',
    404: 'NOT_FOUND',
};

function classify(exception: unknown): { code: ErrorCode; status: number } {
    if (exception instanceof AppError) {
        return { code: exception.code, status: errorDefinition(exception.code).status };
    }
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const code = status >= 500 ? 'INTERNAL_ERROR' : (CODE_BY_STATUS[status] ?? 'HTTP_ERROR');
    return { code, status };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
    constructor(@Inject(RecordErrorService) private readonly errors: RecordErrorService) {}

    catch(exception: unknown, host: ArgumentsHost): void {
        const http = host.switchToHttp();
        const request = http.getRequest<Request>();
        const { code, status } = classify(exception);
        const response = http.getResponse<Response>();
        if (exception instanceof AppError && exception.retryAfterSeconds) {
            response.setHeader('retry-after', String(exception.retryAfterSeconds));
        }
        const correlationId = sendError(request, response, code, status);
        if (status < 500 || errorDefinition(code).record === false) return;

        const cause = exception instanceof AppError ? (exception.cause ?? exception) : exception;
        Logger.error(
            `${request.method} ${maskPath(request.path)} → ${status} (${correlationId}) ` +
                `${code}: ${errorName(cause)}`,
            'GlobalExceptionFilter',
        );
        void this.errors.record({
            error: cause,
            code,
            status,
            correlationId,
            method: request.method,
            path: request.path,
        });
    }
}
