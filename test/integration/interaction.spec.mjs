import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { buildTestApp, oauthClient } from './support/app.mjs';
import { Browser } from './support/browser.mjs';

let env;
let oauth;
let account;

before(async () => {
    env = await buildTestApp();
    oauth = oauthClient(env);
    account = env.gateway.addCredentials('uid-login', 'login@example.test', 'right-password');
});
after(async () => {
    await env?.close();
});

async function start(browser = new Browser()) {
    const request = oauth.authorizationRequest();
    const started = await oauth.follow(browser, request.url);
    return { ...request, browser, path: started.front.pathname };
}

function post(flow, action, body, { origin = env.issuer, contentType } = {}) {
    const headers = { 'content-type': contentType ?? 'application/json' };
    if (origin !== null) headers.origin = origin;
    return flow.browser.request(new URL(flow.path + '/' + action, env.issuer), {
        method: 'POST',
        headers,
        body: body === undefined || typeof body === 'string' ? body : JSON.stringify(body),
    });
}
const credentials = { email: 'login@example.test', password: 'right-password' };
const expectCode = async (response, status, code) => {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), { code });
    assert.equal(response.headers.get('cache-control'), 'no-store');
};

describe('login routes for the front', () => {
    it('describes the pending interaction', async () => {
        const flow = await start();
        const response = await flow.browser.request(new URL(flow.path + '/details', env.issuer));
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.deepEqual(await response.json(), {
            uid: flow.path.split('/')[2],
            clientId: 'web-kontal',
            prompt: 'login',
        });
    });

    it('logs in with e-mail and password and finishes the code flow', async () => {
        const flow = await start();
        const response = await post(flow, 'login', credentials);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const { redirectTo } = await response.json();
        const finished = await oauth.follow(flow.browser, redirectTo);
        const tokens = await oauth.exchange({
            code: finished.callback.searchParams.get('code'),
            verifier: flow.verifier,
        });
        assert.equal(tokens.status, 200, JSON.stringify(tokens.body));
        const claims = JSON.parse(Buffer.from(tokens.body.access_token.split('.')[1], 'base64url'));
        assert.equal(claims.firebase_uid, account.uid);
        assert.notEqual(claims.sub, account.uid);
    });

    for (const [failure, status] of [
        ['INVALID_CREDENTIALS', 401],
        ['ACCOUNT_DISABLED', 403],
        ['MFA_UNSUPPORTED', 403],
        ['TOO_MANY_ATTEMPTS', 429],
        ['AUTH_UNAVAILABLE', 503],
    ]) {
        it('answers ' + failure + ' with status ' + status, async () => {
            const flow = await start();
            env.gateway.failure = failure;
            try {
                await expectCode(await post(flow, 'login', credentials), status, failure);
            } finally {
                env.gateway.failure = undefined;
            }
        });
    }

    it('answers the same for unknown e-mail and wrong password', async () => {
        const flow = await start();
        for (const body of [
            { ...credentials, password: 'wrong' },
            { ...credentials, email: 'nobody@example.test' },
        ]) {
            await expectCode(await post(flow, 'login', body), 401, 'INVALID_CREDENTIALS');
        }
        assert.equal((await post(flow, 'login', credentials)).status, 200);
    });

    it('rejects a disabled auth identity with ACCOUNT_DISABLED', async () => {
        env.gateway.addCredentials('uid-off', 'off@example.test', 'right-password');
        const body = { email: 'off@example.test', password: 'right-password' };
        assert.equal((await post(await start(), 'login', body)).status, 200);
        await env.database.prisma.identity.updateMany({
            where: { email: 'off@example.test' },
            data: { status: 'disabled' },
        });
        await expectCode(await post(await start(), 'login', body), 403, 'ACCOUNT_DISABLED');
    });

    for (const origin of [null, 'https://evil.example.test', 'null']) {
        for (const action of ['login', 'password-reset', 'abort']) {
            it('rejects ' + action + ' with Origin ' + origin, async () => {
                const flow = await start();
                const calls = env.gateway.calls;
                await expectCode(
                    await post(flow, action, credentials, { origin }),
                    403,
                    'ORIGIN_NOT_ALLOWED',
                );
                assert.equal(env.gateway.calls, calls);
            });
        }
    }

    it('rejects a non-JSON content type', async () => {
        const response = await post(await start(), 'login', 'email=a&password=b', {
            contentType: 'application/x-www-form-urlencoded',
        });
        await expectCode(response, 400, 'INVALID_REQUEST');
    });

    for (const [name, body] of [
        ['extra fields', { ...credentials, role: 'admin' }],
        ['an empty password', { ...credentials, password: '' }],
        ['a non-string password', { ...credentials, password: 1 }],
        ['a bad e-mail', { ...credentials, email: 'nope' }],
        ['malformed JSON', '{"email":'],
        ['a body above 4kb', { ...credentials, password: 'a'.repeat(5000) }],
    ]) {
        it('rejects ' + name, async () => {
            await expectCode(await post(await start(), 'login', body), 400, 'INVALID_REQUEST');
        });
    }

    it('answers INTERACTION_EXPIRED without the cookie or with another uid', async () => {
        const flow = await start();
        const calls = env.gateway.calls;
        await expectCode(
            await post({ ...flow, browser: new Browser() }, 'login', credentials),
            410,
            'INTERACTION_EXPIRED',
        );
        const response = await fetch(new URL('/interaction/other/login', env.issuer), {
            method: 'POST',
            headers: {
                origin: env.issuer,
                'content-type': 'application/json',
                cookie: flow.browser.header(flow.path),
            },
            body: JSON.stringify(credentials),
        });
        await expectCode(response, 410, 'INTERACTION_EXPIRED');
        assert.equal(env.gateway.calls, calls);
    });

    it('answers INTERACTION_EXPIRED when login is submitted again after finishing', async () => {
        const flow = await start();
        const saved = new Map(flow.browser.cookies);
        const { redirectTo } = await (await post(flow, 'login', credentials)).json();
        await oauth.follow(flow.browser, redirectTo);
        await expectCode(await post(flow, 'login', credentials), 410, 'INTERACTION_EXPIRED');
        flow.browser.cookies = saved;
        await expectCode(await post(flow, 'login', credentials), 410, 'INTERACTION_EXPIRED');
    });

    it('checks the password once for a simultaneous double submit', async () => {
        const flow = await start();
        const calls = env.gateway.calls;
        const original = env.gateway.signIn;
        env.gateway.signIn = async function (...parameters) {
            await setTimeout(300);
            return original.apply(this, parameters);
        };
        let responses;
        try {
            responses = await Promise.all([
                post(flow, 'login', credentials),
                post(flow, 'login', credentials),
            ]);
        } finally {
            env.gateway.signIn = original;
        }
        for (const response of responses) assert.equal(response.status, 200);
        assert.equal(env.gateway.calls, calls + 1);
    });

    it('repeats the redirect without a new password check after a finished login', async () => {
        const flow = await start();
        const first = await (await post(flow, 'login', credentials)).json();
        const calls = env.gateway.calls;
        const again = await post(flow, 'login', credentials);
        assert.equal(again.status, 200);
        assert.deepEqual(await again.json(), first);
        assert.equal(env.gateway.calls, calls);
    });

    it('checks the password again after a failed attempt', async () => {
        const flow = await start();
        const wrong = { ...credentials, password: 'wrong' };
        assert.equal((await post(flow, 'login', wrong)).status, 401);
        assert.equal((await post(flow, 'login', credentials)).status, 200);
    });

    it('keeps two parallel logins independent', async () => {
        const browser = new Browser();
        const first = await start(browser);
        const second = await start(browser);
        assert.notEqual(first.path, second.path);
        for (const flow of [second, first]) {
            const response = await post(flow, 'login', credentials);
            assert.equal(response.status, 200);
            const finished = await oauth.follow(browser, (await response.json()).redirectTo);
            assert.equal(finished.callback.searchParams.get('state'), flow.state);
        }
    });

    it('answers 204 for password reset whether or not the e-mail exists', async () => {
        for (const email of ['login@example.test', 'nobody@example.test']) {
            const response = await post(await start(), 'password-reset', { email });
            assert.equal(response.status, 204);
            assert.equal(response.headers.get('cache-control'), 'no-store');
        }
        assert.deepEqual(env.gateway.resets.slice(-2), [
            'login@example.test',
            'nobody@example.test',
        ]);
    });

    it('does not send a password reset without a pending interaction', async () => {
        const flow = await start();
        const sent = env.gateway.resets.length;
        await expectCode(
            await post({ ...flow, browser: new Browser() }, 'password-reset', {
                email: 'login@example.test',
            }),
            410,
            'INTERACTION_EXPIRED',
        );
        assert.equal(env.gateway.resets.length, sent);
    });

    it('redirects to the client with access_denied on abort', async () => {
        const flow = await start();
        const response = await post(flow, 'abort');
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const finished = await oauth.follow(flow.browser, (await response.json()).redirectTo);
        assert.equal(finished.callback.searchParams.get('error'), 'access_denied');
        assert.equal(finished.callback.searchParams.get('code'), null);
    });

    it('leaves GET /interaction/:uid to the front', async () => {
        const flow = await start();
        const response = await flow.browser.request(new URL(flow.path, env.issuer));
        assert.equal(response.status, 404);
    });
});
