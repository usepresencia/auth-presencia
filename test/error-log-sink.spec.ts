import { getApps } from 'firebase-admin/app';
import { afterEach, describe, expect, it } from 'vitest';
import { createErrorLogSink } from '../src/modules/errors/infrastructure/firestore-error-log.writer';

const sinks: { onModuleDestroy?: () => Promise<void> }[] = [];
const create = (settings: Parameters<typeof createErrorLogSink>[0]) => {
    const sink = createErrorLogSink(settings);
    sinks.push(sink as (typeof sinks)[number]);
    return sink;
};
afterEach(async () => {
    for (const sink of sinks.splice(0)) await sink.onModuleDestroy?.();
});

describe('error log destination', () => {
    it.each([
        ['a demo project', { FIREBASE_PROJECT_ID: 'demo-presencia' }],
        [
            'the auth emulator',
            {
                FIREBASE_PROJECT_ID: 'real-project',
                FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
            },
        ],
    ])('never connects to a real Firestore with %s', (_name, settings) => {
        const before = getApps().length;
        create(settings);
        expect(getApps()).toHaveLength(before);
    });

    it('writes to the Firestore emulator when it is configured', () => {
        const before = getApps().length;
        create({
            FIREBASE_PROJECT_ID: 'demo-presencia',
            FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
        });
        expect(getApps()).toHaveLength(before + 1);
    });
});
