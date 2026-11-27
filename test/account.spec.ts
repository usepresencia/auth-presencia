import { describe, expect, it } from 'vitest';
import { AccountService } from '../src/modules/accounts/application/account.service';
import type { FirebaseGateway, FirebaseUser } from '../src/modules/accounts/model/firebase.gateway';

const identity = {
    id: 'sub-1',
    status: 'active' as const,
    email: 'old@example.test',
    emailVerified: false,
    createdAt: new Date(),
    projectId: 'demo-presencia',
    uid: 'fb-1',
};
const user: FirebaseUser = {
    uid: 'fb-1',
    email: 'person@example.test',
    emailVerified: true,
    name: 'Fixture Person',
    disabled: false,
    validSince: 1000,
    customClaims: { platformRole: 'INTERNAL_ADMIN', secretFlag: true },
};

function service(
    options: { identity?: typeof identity | null; user?: FirebaseUser | null } = {},
    getUser?: FirebaseGateway['getUser'],
) {
    const found = options.identity === undefined ? identity : options.identity;
    const firebaseUser = options.user === undefined ? user : options.user;
    return new AccountService(
        { findActiveById: async () => found },
        { getUser: getUser ?? (async () => firebaseUser) },
        'demo-presencia',
    );
}
const allowed = { firebaseClaims: ['platformRole', 'kontalMemberships'] };

describe('account loading', () => {
    it('returns the standard claims plus only the allowed firebase claims', async () => {
        await expect(service().load('sub-1', allowed)).resolves.toEqual({
            sub: 'sub-1',
            claims: {
                sub: 'sub-1',
                firebase_uid: 'fb-1',
                firebase_project: 'demo-presencia',
                email: 'person@example.test',
                email_verified: true,
                name: 'Fixture Person',
                platformRole: 'INTERNAL_ADMIN',
            },
        });
    });

    it('omits claims the user does not have', async () => {
        const bare = { ...user, email: undefined, name: undefined, customClaims: {} };
        const account = await service({ user: bare }).load('sub-1', allowed);
        expect(Object.keys(account!.claims).sort()).toEqual([
            'email_verified',
            'firebase_project',
            'firebase_uid',
            'sub',
        ]);
    });

    it('never lets a custom claim replace a standard one', async () => {
        const forged = { ...user, customClaims: { sub: 'other', firebase_uid: 'other' } };
        const account = await service({ user: forged }).load('sub-1', {
            firebaseClaims: ['sub', 'firebase_uid'],
        });
        expect(account!.claims).toMatchObject({ sub: 'sub-1', firebase_uid: 'fb-1' });
    });

    it.each([
        ['unknown or disabled identity', { identity: null }],
        ['missing firebase user', { user: null }],
        ['disabled firebase user', { user: { ...user, disabled: true } }],
    ])('returns null for %s', async (_name, options) => {
        await expect(service(options).load('sub-1', allowed)).resolves.toBeNull();
    });

    it('returns null when credentials were revoked after the login', async () => {
        await expect(service().load('sub-1', { ...allowed, authTime: 999 })).resolves.toBeNull();
        await expect(
            service().load('sub-1', { ...allowed, authTime: 1000 }),
        ).resolves.not.toBeNull();
    });

    it('propagates a gateway failure instead of returning null', async () => {
        const failing = service({}, async () => {
            throw new Error('firebase unavailable');
        });
        await expect(failing.load('sub-1', allowed)).rejects.toThrow('firebase unavailable');
    });

    it('rejects identities from another firebase project', async () => {
        const foreign = { ...identity, projectId: 'another-project' };
        await expect(service({ identity: foreign }).load('sub-1', allowed)).resolves.toBeNull();
    });
});
