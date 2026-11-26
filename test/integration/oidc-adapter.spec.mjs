import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createPrismaAdapter } from '../../dist/modules/oidc/prisma.adapter.js';
import { createTestDatabase } from './support/database.mjs';

let database;
let prisma;
let adapter;

before(async () => {
    database = await createTestDatabase();
    prisma = database.prisma;
    adapter = createPrismaAdapter(prisma);
});
after(async () => {
    await database?.drop();
});
beforeEach(async () => {
    await prisma.oidcArtifact.deleteMany();
});

const token = (grantId, extra = {}) => ({ jti: randomUUID(), grantId, accountId: 'sub', ...extra });
const save = async (model, payload, expiresIn = 60) => {
    await adapter(model).upsert(payload.jti, payload, expiresIn);
    return payload;
};

describe('Prisma adapter for oidc-provider', () => {
    it('round-trips a payload and survives a new client', async () => {
        const payload = await save('Interaction', { jti: randomUUID(), params: { a: [1, 'b'] } });
        const other = database.connect();
        try {
            const found = await createPrismaAdapter(other)('Interaction').find(payload.jti);
            assert.deepEqual(found, payload);
        } finally {
            await other.$disconnect();
        }
    });

    it('keeps models apart and updates on a second upsert', async () => {
        const payload = await save('Session', { jti: randomUUID(), uid: 'u', n: 1 });
        await save('Session', { ...payload, n: 2 });
        assert.equal((await adapter('Session').find(payload.jti)).n, 2);
        assert.equal(await adapter('Interaction').find(payload.jti), undefined);
    });

    it('does not return expired artifacts', async () => {
        const payload = await save('Session', { jti: randomUUID(), uid: 'expired' }, -1);
        assert.equal(await adapter('Session').find(payload.jti), undefined);
        assert.equal(await adapter('Session').findByUid('expired'), undefined);
    });

    it('removes expired rows of the same model on a later upsert', async () => {
        await save('Session', { jti: randomUUID(), uid: 'old' }, -1);
        await save('Session', { jti: randomUUID(), uid: 'new' });
        assert.equal(await prisma.oidcArtifact.count(), 1);
    });

    it('finds a session by uid and by user code', async () => {
        const session = await save('Session', { jti: randomUUID(), uid: 'the-uid' });
        const found = await adapter('Session').findByUid('the-uid');
        assert.equal(found.uid, session.uid);
        assert.equal(found.jti, undefined);
        const device = await save('DeviceCode', { jti: randomUUID(), userCode: 'CODE' });
        assert.equal((await adapter('DeviceCode').findByUserCode('CODE')).jti, device.jti);
    });

    for (const model of ['AuthorizationCode', 'RefreshToken']) {
        it('never stores a ' + model + ' id in clear text', async () => {
            const payload = await save(model, token('grant'));
            const rows = await prisma.oidcArtifact.findMany();
            assert.ok(!JSON.stringify(rows).includes(payload.jti));
            assert.equal((await adapter(model).find(payload.jti)).jti, payload.jti);
        });
    }

    it('never stores a Session id in clear text, not even inside an interaction', async () => {
        const session = await save('Session', { jti: randomUUID(), uid: 'secret-session' });
        await save('Interaction', {
            jti: randomUUID(),
            session: { uid: 'secret-session', accountId: 'sub', cookie: session.jti },
        });
        const rows = await prisma.oidcArtifact.findMany();
        assert.ok(!JSON.stringify(rows).includes(session.jti));
        assert.equal((await adapter('Session').find(session.jti)).jti, session.jti);
        await adapter('Session').destroy(session.jti);
        assert.equal(await adapter('Session').find(session.jti), undefined);
    });

    it('marks consumed artifacts and keeps the mark after a new upsert', async () => {
        const payload = await save('RefreshToken', token('grant'));
        await adapter('RefreshToken').consume(payload.jti);
        await save('RefreshToken', payload);
        assert.equal(typeof (await adapter('RefreshToken').find(payload.jti)).consumed, 'number');
    });

    it('lets exactly one of 16 concurrent consume calls succeed', async () => {
        const payload = await save('RefreshToken', token('grant'));
        const results = await Promise.allSettled(
            Array.from({ length: 16 }, () => adapter('RefreshToken').consume(payload.jti)),
        );
        assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
        const failures = results.filter(r => r.status === 'rejected');
        assert.equal(failures.length, 15);
        assert.ok(failures.every(r => r.reason.error === 'invalid_grant'));
    });

    it('removes the grant and its artifacts when consume loses the race', async () => {
        const grantId = randomUUID();
        await save('Grant', { jti: grantId });
        const access = await save('AccessToken', token(grantId));
        const refresh = await save('RefreshToken', token(grantId));
        await adapter('RefreshToken').consume(refresh.jti);
        await assert.rejects(adapter('RefreshToken').consume(refresh.jti), {
            error: 'invalid_grant',
        });
        assert.equal(await adapter('Grant').find(grantId), undefined);
        assert.equal(await adapter('AccessToken').find(access.jti), undefined);
        assert.equal(await adapter('RefreshToken').find(refresh.jti), undefined);
    });

    it('refuses to consume an artifact that no longer exists', async () => {
        await assert.rejects(adapter('AuthorizationCode').consume('missing'), {
            error: 'invalid_grant',
        });
    });

    it('revokeByGrantId removes only that grant', async () => {
        const gone = await save('RefreshToken', token('grant-a'));
        const kept = await save('RefreshToken', token('grant-b'));
        await adapter('RefreshToken').revokeByGrantId('grant-a');
        assert.equal(await adapter('RefreshToken').find(gone.jti), undefined);
        assert.ok(await adapter('RefreshToken').find(kept.jti));
    });

    it('keeps interactions that only reference the revoked grant', async () => {
        const pending = await save('Interaction', token('grant-c'));
        await save('RefreshToken', token('grant-c'));
        await adapter('RefreshToken').revokeByGrantId('grant-c');
        assert.ok(await adapter('Interaction').find(pending.jti));
    });

    it('destroys one artifact and tolerates a missing one', async () => {
        const payload = await save('AuthorizationCode', token('grant'));
        await adapter('AuthorizationCode').destroy(payload.jti);
        await adapter('AuthorizationCode').destroy(payload.jti);
        assert.equal(await adapter('AuthorizationCode').find(payload.jti), undefined);
    });
});
