import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createTokenVerifier } from '@usepresencia/auth/api';
import { buildTestApp, oauthClient } from '../integration/support/app.mjs';

let env;
let oauth;
let person;
let tokens;

before(async () => {
    env = await buildTestApp();
    oauth = oauthClient(env);
    person = await env.person();
    const { status, body } = await oauth.exchange(await oauth.login(person.sub));
    assert.equal(status, 200, JSON.stringify(body));
    tokens = body;
});
after(async () => {
    await env?.close();
});

const verifier = (options = {}) =>
    createTokenVerifier({
        issuer: env.issuer,
        audience: 'api-kontal',
        scopes: ['api'],
        ...options,
    });
const refusedWith = code => error => error.name === 'TokenError' && error.code === code;

describe('published @usepresencia/auth against this service', () => {
    it('accepts the access token and returns the person', async () => {
        const verified = await verifier()(tokens.access_token);
        assert.equal(verified.sub, person.sub);
        assert.equal(verified.clientId, 'web-kontal');
        assert.deepEqual(verified.scopes, ['api']);
        assert.equal(verified.firebaseUid, person.uid);
        assert.equal(verified.firebaseProject, 'demo-presencia');
        assert.equal(verified.email, person.user.email);
        assert.equal(verified.emailVerified, true);
        assert.equal(verified.name, 'Fixture Person');
        assert.equal(verified.claims.platformRole, 'INTERNAL_ADMIN');
        assert.equal(verified.claims.hidden, undefined);
    });

    it('accepts the access token obtained with a refresh token', async () => {
        const { status, body } = await oauth.refresh(tokens.refresh_token);
        assert.equal(status, 200, JSON.stringify(body));
        assert.equal((await verifier()(body.access_token)).sub, person.sub);
    });

    for (const [name, attempt, code] of [
        ['the ID token', () => verifier()(tokens.id_token), 'INVALID_TOKEN'],
        [
            'the token in another API',
            () => verifier({ audience: 'api-presencia' })(tokens.access_token),
            'INVALID_TOKEN',
        ],
        [
            'a token without the required scope',
            () => verifier({ scopes: ['admin'] })(tokens.access_token),
            'INSUFFICIENT_SCOPE',
        ],
        [
            'a changed signature',
            () => verifier()(tokens.access_token.slice(0, -8) + 'AAAAAAAA'),
            'INVALID_TOKEN',
        ],
    ]) {
        it('refuses ' + name, async () => {
            await assert.rejects(attempt, refusedWith(code));
        });
    }
});
