import { Logger } from '@nestjs/common';
import { errorName } from '../../../shared/utils/error-name';
import { maskPath, type ErrorLogSink, type ErrorReport } from '../model/error-log';

const MAX_MESSAGE = 2000;
const MAX_STACK = 8000;
const STACK_FRAME = /^\s+at .+:\d+:\d+\)?$/;

function stackFrames(error: unknown): string | undefined {
    if (!(error instanceof Error) || !error.stack) return undefined;
    const frames = error.stack.split('\n').filter(line => STACK_FRAME.test(line));
    return frames.length > 0 ? frames.join('\n').slice(0, MAX_STACK) : undefined;
}

export class RecordErrorService {
    constructor(private readonly sink: ErrorLogSink) {}

    /**
     * Grava a falha sem a mensagem original: somente o tipo do erro, o código e as linhas do
     * stack. Nunca lança.
     */
    async record(report: ErrorReport & { code: string }): Promise<void> {
        const now = new Date().toISOString();
        const stack = stackFrames(report.error);
        try {
            await this.sink.write({
                level: 'error',
                source: 'api',
                module: 'auth-presencia',
                code: report.code,
                message: `${errorName(report.error)} (${report.code})`.slice(0, MAX_MESSAGE),
                ...(stack ? { stack } : {}),
                correlationId: report.correlationId,
                context: {
                    method: report.method,
                    url: maskPath(report.path),
                    status: report.status,
                },
                timestamp: now,
                savedAt: now,
            });
        } catch (error) {
            Logger.warn(
                `Falha ao gravar log de erro ${report.correlationId}: ${errorName(error)}`,
                'RecordErrorService',
            );
        }
    }
}
