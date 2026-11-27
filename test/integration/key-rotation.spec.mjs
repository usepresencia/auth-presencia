// Processo real (dist/main.js) com o emulador do Firebase, reiniciado a cada passo da rotação.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { rotate } from '../../scripts/key-rotation.mjs';
import { kontalClient, secret, signingKey } from '../support/fixtures.mjs';
import { oauthClient } from './support/app.mjs';
import { Browser } from './support/browser.mjs';
import { createTestDatabase } from './support/database.mjs';
import { firebaseFixtures, password } from './support/firebase.mjs';

const client = kontalClient('http://127.0.0.1:1/callback', 'http://127.0.0.1:1/bye');
let database;
let fixtures;
let env;
let process_;
let user;
let keys = {
    AUTH_JWKS: JSON.stringify({ keys: [signingKey('first')] }),
    AUTH_COOKIE_KEYS: secret(),
};

async function freePort() {
    const server = createServer().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

async function stop() {
    if (!process_ || process_.exitCode !== null) return;
    process_.kill('SIGTERM');
    await once(process_, 'exit');
}

async function restart(next = keys) {
    await stop();
    keys = next;
    process_ = spawn(process.execPath, ['dist/main.js'], {
        env: {
            ...process.env,
            ...keys,
            NODE_ENV: 'test',
            PORT: new URL(env.issuer).port,
            HOST: '127.0.0.1',
            AUTH_ISSUER: env.issuer,
            DATABASE_URL: database.url,
            AUTH_CLIENTS: JSON.stringify([client]),
            FIREBASE_PROJECT_ID: 'demo-presencia',
            FIREBASE_API_KEY: 'fake-api-key',
        },
        stdio: 'ignore',
    });
    for (let attempt = 0; attempt < 100; attempt++) {
        if (await fetch(env.issuer + '/health/live').catch(() => undefined)) return;
        await setTimeout(100);
    }
    throw new Error('application did not start');
}

before(async () => {
    database = await createTestDatabase();
    fixtures = firebaseFixtures();
    user = await fixtures.createUser();
    env = { issuer: 'http://127.0.0.1:' + (await freePort()), client };
    await restart();
});
after(async () => {
    await stop();
    await fixtures?.cleanup();
    await database?.drop();
});

async function signIn(browser = new Browser()) {
    const oauth = oauthClient(env);
    const request = oauth.authorizationRequest();
    const started = await oauth.follow(browser, request.url);
    let callback = started.callback;
    if (!callback) {
        const response = await browser.request(
            new URL(started.front.pathname + '/login', env.issuer),
            {
                method: 'POST',
                headers: { origin: env.issuer, 'content-type': 'application/json' },
                body: JSON.stringify({ email: user.email, password }),
            },
        );
        callback = (await oauth.follow(browser, (await response.json()).redirectTo)).callback;
    }
    const { body } = await oauth.exchange({
        code: callback.searchParams.get('code'),
        verifier: request.verifier,
    });
    return { tokens: body, browser, askedPassword: !started.callback };
}

const jwks = async () => (await fetch(env.issuer + '/jwks')).json();
const kid = token => JSON.parse(Buffer.from(token.split('.')[0], 'base64url')).kid;
const verify = async token =>
    jwtVerify(token, createLocalJWKSet(await jwks()), {
        issuer: env.issuer,
        audience: 'api-kontal',
    });

describe('key rotation', () => {
    it('keeps tokens and sessions valid until the old keys are retired', async () => {
        const first = await signIn();
        assert.equal(kid(first.tokens.access_token), 'first');

        await restart(rotate('add', keys));
        const published = (await jwks()).keys;
        assert.equal(published.length, 2);
        for (const key of published) assert.equal(key.d, undefined);
        assert.equal(kid((await signIn()).tokens.access_token), 'first');

        await restart(rotate('promote', keys));
        const promoted = await signIn(first.browser);
        assert.notEqual(kid(promoted.tokens.access_token), 'first');
        assert.equal(promoted.askedPassword, false);
        await verify(first.tokens.access_token);
        const refreshed = await oauthClient(env).refresh(first.tokens.refresh_token);
        assert.equal(refreshed.status, 200, JSON.stringify(refreshed.body));

        await restart(rotate('retire', keys));
        await assert.rejects(verify(first.tokens.access_token));
        await verify(promoted.tokens.access_token);
    });

    it('ends every session and refuses old tokens when keys are replaced', async () => {
        const before = await signIn();
        await restart(rotate('replace', keys));
        await assert.rejects(verify(before.tokens.access_token));
        assert.equal((await signIn(before.browser)).askedPassword, true);
    });

    it('does not start with a missing signing key', async () => {
        await assert.rejects(restart({ ...keys, AUTH_JWKS: '' }));
    });
});
