export const ERROR_LOG_SINK = Symbol.for('auth-presencia.error-log-sink');

export interface ErrorLogEntry {
    level: 'error';
    source: 'api';
    module: 'auth-presencia';
    code: string;
    message: string;
    stack?: string;
    correlationId: string;
    context: { method: string; url: string; status: number };
    timestamp: string;
    savedAt: string;
}

export interface ErrorLogSink {
    write(entry: ErrorLogEntry): Promise<void>;
}

export interface ErrorReport {
    error: unknown;
    correlationId: string;
    status: number;
    method: string;
    path: string;
}

export function maskPath(path: string): string {
    return path.replace(/^\/(interaction|authorize)\/[^/]+/i, '/$1/:uid');
}
