import { randomUUID } from 'node:crypto';

export const CORRELATION_HEADER = 'x-correlation-id';

const SAFE_ID = /^[A-Za-z0-9_-]{8,128}$/;

/** Reaproveita o id recebido se puder ser id de documento; caso contrário gera um UUID. */
export function resolveCorrelationId(incoming: unknown): string {
    const value: unknown = Array.isArray(incoming) ? incoming[0] : incoming;
    return typeof value === 'string' && SAFE_ID.test(value) ? value : randomUUID();
}
