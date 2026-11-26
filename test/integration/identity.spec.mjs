import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaIdentityRepository } from '../../dist/modules/identity/infrastructure/prisma-identity.repository.js';
import { IdentityService } from '../../dist/modules/identity/application/identity.service.js';
import { IdentityDisabledError } from '../../dist/modules/identity/domain/identity.js';
import { createTestDatabase, migrate } from './support/database.mjs';

let database;
let prisma;
let service;
const principal = {
    projectId: 'demo-presencia',
    uid: 'fixture-user',
    email: 'fixture@example.test',
    emailVerified: true,
};

before(async () => {
    database = await createTestDatabase();
    prisma = database.prisma;
    service = new IdentityService(new PrismaIdentityRepository(prisma));
});

after(async () => {
    await database?.drop();
});

beforeEach(async () => {
    await prisma.firebaseIdentity.deleteMany();
    await prisma.identity.deleteMany();
});

describe('PostgreSQL identity foundation', () => {
    it('concurrent first login produces one stable identity without orphan rows', async () => {
        const identities = await Promise.all(
            Array.from({ length: 16 }, () => service.resolveVerifiedFirebaseIdentity(principal)),
        );
        assert.equal(new Set(identities.map(i => i.id)).size, 1);
        assert.notEqual(identities[0].id, principal.uid);
        assert.equal(await prisma.identity.count(), 1);
    });

    it('never merges by email or UID across Firebase projects', async () => {
        const first = await service.resolveVerifiedFirebaseIdentity(principal);
        const second = await service.resolveVerifiedFirebaseIdentity({
            ...principal,
            projectId: 'another-project',
        });
        const third = await service.resolveVerifiedFirebaseIdentity({
            ...principal,
            uid: 'another-user',
        });
        assert.equal(new Set([first.id, second.id, third.id]).size, 3);
    });

    it('denies disabled identities without creating replacements', async () => {
        const identity = await service.resolveVerifiedFirebaseIdentity(principal);
        await prisma.identity.update({ where: { id: identity.id }, data: { status: 'disabled' } });
        await assert.rejects(
            service.resolveVerifiedFirebaseIdentity(principal),
            IdentityDisabledError,
        );
        assert.equal(await prisma.identity.count(), 1);
    });

    it('treats external UID as a parameter, including SQL-like characters', async () => {
        const value = { ...principal, uid: "fixture'; DROP TABLE auth_identities; --" };
        const first = await service.resolveVerifiedFirebaseIdentity(value);
        const second = await service.resolveVerifiedFirebaseIdentity(value);
        assert.equal(first.id, second.id);
    });

    it('rejects invalid principal input before writing any identity', async () => {
        await assert.rejects(service.resolveVerifiedFirebaseIdentity({ ...principal, uid: '' }));
        await assert.rejects(
            service.resolveVerifiedFirebaseIdentity({ ...principal, projectId: '../other' }),
        );
        assert.equal(await prisma.identity.count(), 0);
    });

    it('keeps the database constraints on status and external keys', async () => {
        await assert.rejects(
            prisma.identity.create({ data: { id: randomUUID(), status: 'unknown' } }),
        );
        const identity = await prisma.identity.create({ data: { id: randomUUID() } });
        await assert.rejects(
            prisma.firebaseIdentity.create({
                data: { firebaseProjectId: '', firebaseUid: 'uid', identityId: identity.id },
            }),
        );
        await prisma.firebaseIdentity.create({
            data: { firebaseProjectId: 'demo', firebaseUid: 'uid', identityId: identity.id },
        });
        await assert.rejects(prisma.identity.delete({ where: { id: identity.id } }));
    });

    it('rolls back a failed transaction', async () => {
        await assert.rejects(
            prisma.$transaction(async tx => {
                await tx.identity.create({ data: { id: randomUUID() } });
                throw new Error('fixture rollback');
            }),
            /fixture rollback/,
        );
        assert.equal(await prisma.identity.count(), 0);
    });

    it('finds an active identity by id with its firebase link', async () => {
        const identity = await service.resolveVerifiedFirebaseIdentity(principal);
        const found = await service.findActiveById(identity.id);
        assert.equal(found.id, identity.id);
        assert.equal(found.projectId, principal.projectId);
        assert.equal(found.uid, principal.uid);
    });

    it('finds nothing for disabled, unknown or malformed ids', async () => {
        const identity = await service.resolveVerifiedFirebaseIdentity(principal);
        await prisma.identity.update({ where: { id: identity.id }, data: { status: 'disabled' } });
        assert.equal(await service.findActiveById(identity.id), null);
        assert.equal(await service.findActiveById(randomUUID()), null);
        assert.equal(await service.findActiveById("' OR 1=1 --"), null);
    });

    it('migrations are idempotent', () => {
        assert.match(migrate(database.url), /No pending migrations/);
    });
});
