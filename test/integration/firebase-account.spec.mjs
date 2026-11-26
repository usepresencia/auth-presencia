import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { FirebaseAdminGateway } from '../../dist/modules/accounts/firebase-admin.gateway.js';
import { firebaseFixtures, projectId } from './support/firebase.mjs';

let fixtures;
let gateway;

before(() => {
    fixtures = firebaseFixtures();
    gateway = new FirebaseAdminGateway({ FIREBASE_PROJECT_ID: projectId });
});
after(async () => {
    await gateway?.onModuleDestroy();
    await fixtures?.cleanup();
});

const createUser = (extra = {}) => fixtures.createUser({ displayName: 'Fixture Person', ...extra });

describe('Firebase gateway against the emulator', () => {
    it('returns profile and custom claims of a user', async () => {
        const user = await createUser({ emailVerified: true });
        await fixtures.auth.setCustomUserClaims(user.uid, { platformRole: 'INTERNAL_ADMIN' });
        const found = await gateway.getUser(user.uid);
        assert.equal(found.uid, user.uid);
        assert.equal(found.email, user.email);
        assert.equal(found.emailVerified, true);
        assert.equal(found.name, 'Fixture Person');
        assert.equal(found.disabled, false);
        assert.deepEqual(found.customClaims, { platformRole: 'INTERNAL_ADMIN' });
    });

    it('reports disabled users', async () => {
        const user = await createUser({ disabled: true });
        assert.equal((await gateway.getUser(user.uid)).disabled, true);
    });

    it('reports when credentials were last revoked, in seconds', async () => {
        const user = await createUser();
        const before = Math.floor(Date.now() / 1000);
        await fixtures.auth.revokeRefreshTokens(user.uid);
        const { validSince } = await gateway.getUser(user.uid);
        assert.ok(validSince >= before - 1 && validSince <= before + 60, String(validSince));
    });

    it('returns null for an unknown uid', async () => {
        assert.equal(await gateway.getUser('missing-' + randomUUID()), null);
    });
});
