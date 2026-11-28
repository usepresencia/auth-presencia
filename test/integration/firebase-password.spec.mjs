import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { FirebaseAdminGateway } from '../../dist/modules/accounts/infrastructure/firebase-admin.gateway.js';
import { firebaseFixtures, projectId } from './support/firebase.mjs';

let fixtures;
let gateway;

before(() => {
    fixtures = firebaseFixtures();
    gateway = new FirebaseAdminGateway({
        FIREBASE_PROJECT_ID: projectId,
        FIREBASE_WEB_API_KEY: 'fake-api-key',
    });
});
after(async () => {
    await gateway?.onModuleDestroy();
    await fixtures?.cleanup();
});

async function invited(extra) {
    const user = await fixtures.createUser({ password: undefined, ...extra });
    const link = await fixtures.auth.generatePasswordResetLink(user.email);
    return { ...user, code: new URL(link).searchParams.get('oobCode') };
}
const password = 'chosen-password-123';

describe('password code against the emulator', () => {
    it('sets the first password, verifies the e-mail and allows signing in', async () => {
        const user = await invited();
        assert.equal(await gateway.definePassword(user.code, password), user.email);
        assert.equal((await gateway.signIn(user.email, password)).emailVerified, true);
    });

    it('refuses a used or unknown code', async () => {
        const user = await invited();
        await gateway.definePassword(user.code, password);
        for (const code of [user.code, 'unknown']) {
            await assert.rejects(gateway.definePassword(code, password), {
                code: 'PASSWORD_CODE_INVALID',
            });
        }
    });

    it('refuses a weak password without spending the code', async () => {
        const user = await invited();
        await assert.rejects(gateway.definePassword(user.code, '1'), { code: 'WEAK_PASSWORD' });
        await gateway.definePassword(user.code, password);
    });

    it('refuses a disabled account without changing it', async () => {
        const user = await invited({ disabled: true });
        await assert.rejects(gateway.definePassword(user.code, password), {
            code: 'ACCOUNT_DISABLED',
        });
        assert.deepEqual((await fixtures.auth.getUser(user.uid)).providerData, []);
    });
});
