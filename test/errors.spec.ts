import { describe, expect, it, vi } from 'vitest';
import { RecordErrorService } from '../src/modules/errors/application/record-error.service';
import type { ErrorLogEntry } from '../src/modules/errors/model/error-log';

const request = {
    correlationId: 'fixture-correlation',
    code: 'AUTH_UNAVAILABLE',
    status: 503,
    method: 'POST',
    path: '/interaction/secret-uid/login',
};

async function recorded(error: unknown, extra = {}) {
    const entries: ErrorLogEntry[] = [];
    const service = new RecordErrorService({
        write: entry => {
            entries.push(entry);
            return Promise.resolve();
        },
    });
    await service.record({ ...request, ...extra, error });
    return entries[0]!;
}

describe('error recording', () => {
    it('writes the entry in the format read by the console', async () => {
        const entry = await recorded(new TypeError('boom'));
        expect(entry).toMatchObject({
            level: 'error',
            source: 'api',
            module: 'auth-presencia',
            code: 'AUTH_UNAVAILABLE',
            correlationId: 'fixture-correlation',
            message: 'TypeError (AUTH_UNAVAILABLE)',
            context: { method: 'POST', url: '/interaction/:uid/login', status: 503 },
        });
        expect(Number.isNaN(Date.parse(entry.timestamp))).toBe(false);
        expect(entry.savedAt).toBe(entry.timestamp);
    });

    it('keeps the stack frames and never the error message', async () => {
        const error = new Error('password=sensitive\n    at sensitive-line');
        const entry = await recorded(error);
        expect(JSON.stringify(entry)).not.toContain('sensitive');
        expect(entry.stack).toMatch(/errors\.spec\.ts:\d+:\d+/);
    });

    it.each([
        ['/authorize/resume-uid', '/authorize/:uid'],
        ['/interaction/abc/password-reset', '/interaction/:uid/password-reset'],
        ['/token', '/token'],
    ])('hides identifiers in %s', async (path, url) => {
        expect((await recorded(new Error(), { path })).context.url).toBe(url);
    });

    it('limits the stack size', async () => {
        const error = new Error('x');
        error.stack = 'Error: x\n' + '    at f (file.ts:1:1)\n'.repeat(2000);
        expect((await recorded(error)).stack!.length).toBeLessThanOrEqual(8000);
    });

    it('describes a thrown value that is not an error', async () => {
        const entry = await recorded('sensitive');
        expect(entry.message).toBe('desconhecida (AUTH_UNAVAILABLE)');
        expect(entry.stack).toBeUndefined();
    });

    it('never throws when the sink fails', async () => {
        const write = vi.fn(() => Promise.reject(new Error('firestore down')));
        const service = new RecordErrorService({ write });
        await expect(service.record({ ...request, error: new Error() })).resolves.toBeUndefined();
        expect(write).toHaveBeenCalledOnce();
    });
});
