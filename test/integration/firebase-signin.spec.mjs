import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { FirebaseAdminGateway } from '../../dist/modules/accounts/firebase-admin.gateway.js';
import { emulatorHost, firebaseFixtures, password, projectId } from './support/firebase.mjs';

const host = emulatorHost();
const urls = [];
let fixtures;
let gateway;

before(() => {
    fixtures = firebaseFixtures();
    gateway = new FirebaseAdminGateway(
        { FIREBASE_PROJECT_ID: projectId, FIREBASE_API_KEY: 'fake-api-key' },
        {
            fetch: (url, options) => {
                urls.push(new URL(url));
                return fetch(url, options);
            },
        },
    );
});
after(async () => {
    await gateway?.onModuleDestroy();
    await fixtures?.cleanup();
});

const createUser = extra => fixtures.createUser(extra);

describe('Firebase sign-in against the emulator', () => {
    it('signs in a real emulator user and returns the verified principal', async () => {
        const user = await createUser({ emailVerified: true });
        assert.deepEqual(await gateway.signIn(user.email, password), {
            projectId,
            uid: user.uid,
            email: user.email,
            emailVerified: true,
        });
    });

    for (const [name, extra, attempt, code] of [
        ['wrong password', {}, user => [user.email, 'wrong-password'], 'INVALID_CREDENTIALS'],
        ['unknown e-mail', {}, () => ['nobody@example.test', password], 'INVALID_CREDENTIALS'],
        ['disabled user', { disabled: true }, user => [user.email, password], 'ACCOUNT_DISABLED'],
    ]) {
        it('maps the emulator error for ' + name, async () => {
            const user = await createUser(extra);
            await assert.rejects(gateway.signIn(...attempt(user)), { code });
        });
    }

    it('creates a password reset code for an existing user', async () => {
        const user = await createUser();
        await gateway.sendPasswordReset(user.email);
        const response = await fetch(
            'http://' + host + '/emulator/v1/projects/' + projectId + '/oobCodes',
        );
        const { oobCodes } = await response.json();
        assert.ok(oobCodes.some(c => c.email === user.email && c.requestType === 'PASSWORD_RESET'));
    });

    it('accepts a password reset for an unknown e-mail', async () => {
        await gateway.sendPasswordReset('nobody@example.test');
    });

    it('uses only the emulator host when it is configured', () => {
        assert.ok(urls.length > 0);
        assert.ok(urls.every(url => url.host === host && url.protocol === 'http:'));
    });
});
