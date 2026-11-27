import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { buildTestApp, oauthClient } from './support/app.mjs';
import { Browser } from './support/browser.mjs';

let env;
let oauth;
const email = 'audit@example.test';
const password = 'sensitive-password';

before(async () => {
    env = await buildTestApp();
    oauth = oauthClient(env);
    env.gateway.addCredentials('uid-audit', email, password);
});
after(async () => {
    await env?.close();
});
beforeEach(async () => {
    await env.database.prisma.rateLimit.deleteMany();
    await env.database.prisma.auditEvent.deleteMany();
});

const events = () => env.database.prisma.auditEvent.findMany({ orderBy: { occurredAt: 'asc' } });
const types = async () => (await events()).map(event => event.type);

/** Eventos do protocolo são gravados depois da resposta. */
async function eventOf(type) {
    for (let attempt = 0; attempt < 40; attempt++) {
        const found = (await events()).find(event => event.type === type);
        if (found) return found;
        await setTimeout(50);
    }
    return undefined;
}

async function login(secret = password, correlationId = randomUUID()) {
    const browser = new Browser();
    const request = oauth.authorizationRequest();
    const started = await oauth.follow(browser, request.url);
    const response = await browser.request(new URL(started.front.pathname + '/login', env.issuer), {
        method: 'POST',
        headers: {
            origin: env.issuer,
            'content-type': 'application/json',
            'x-correlation-id': correlationId,
        },
        body: JSON.stringify({ email, password: secret }),
    });
    return { browser, request, response, started };
}

async function signedIn() {
    const attempt = await login();
    const finished = await oauth.follow(
        attempt.browser,
        (await attempt.response.json()).redirectTo,
    );
    const authorization = {
        code: finished.callback.searchParams.get('code'),
        verifier: attempt.request.verifier,
    };
    const { body } = await oauth.exchange(authorization);
    return { ...attempt, authorization, tokens: body };
}

describe('security audit', () => {
    it('records a successful login with the person, client and correlation id', async () => {
        const correlationId = randomUUID();
        assert.equal((await login(password, correlationId)).response.status, 200);
        const [event] = await events();
        assert.equal(event.type, 'login_succeeded');
        assert.equal(event.clientId, 'web-kontal');
        assert.equal(event.correlationId, correlationId);
        assert.match(event.identityId, /^[0-9a-f-]{36}$/);
        assert.equal(event.reason, null);
        assert.ok(event.emailHash && event.addressHash);
    });

    it('records refusals with their reason, including blocked attempts', async () => {
        for (let i = 0; i < 6; i++) await login('wrong-' + i);
        const stored = await events();
        assert.equal(stored.length, 6);
        assert.ok(stored.every(event => event.type === 'login_failed'));
        assert.equal(stored[0].reason, 'INVALID_CREDENTIALS');
        assert.equal(stored[5].reason, 'TOO_MANY_ATTEMPTS');
        assert.equal(stored[0].identityId, null);
    });

    it('records an outage as a failed login', async () => {
        env.gateway.down = true;
        try {
            await login();
        } finally {
            env.gateway.down = false;
        }
        assert.equal((await events())[0].reason, 'AUTH_UNAVAILABLE');
    });

    it('records a password reset request', async () => {
        const attempt = await login('wrong');
        await attempt.browser.request(
            new URL(attempt.started.front.pathname + '/password-reset', env.issuer),
            {
                method: 'POST',
                headers: { origin: env.issuer, 'content-type': 'application/json' },
                body: JSON.stringify({ email }),
            },
        );
        assert.deepEqual(await types(), ['login_failed', 'password_reset_requested']);
    });

    it('records the reuse of a refresh token with the person and client', async () => {
        const { tokens } = await signedIn();
        await oauth.refresh(tokens.refresh_token);
        assert.equal((await oauth.refresh(tokens.refresh_token)).status, 400);
        const event = await eventOf('token_reuse_detected');
        assert.equal(event?.clientId, 'web-kontal');
        assert.equal(event.identityId, (await events())[0].identityId);
    });

    it('records the reuse of an authorization code with the client', async () => {
        const { authorization } = await signedIn();
        assert.equal((await oauth.exchange(authorization)).status, 400);
        assert.equal((await eventOf('token_reuse_detected'))?.clientId, 'web-kontal');
    });

    it('does not call an unknown token a reuse', async () => {
        await oauth.refresh('unknown');
        await setTimeout(200);
        assert.deepEqual(await types(), []);
    });

    it('records the logout', async () => {
        const { browser } = await signedIn();
        await browser.request(new URL('/session/end?client_id=web-kontal', env.issuer));
        const info = await (
            await browser.request(new URL('/session/logout-details', env.issuer))
        ).json();
        await browser.request(new URL(info.action, env.issuer), {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded', origin: env.issuer },
            body: new URLSearchParams({ xsrf: info.xsrf, logout: 'yes' }).toString(),
        });
        const event = await eventOf('logout');
        assert.equal(event?.identityId, (await events())[0].identityId);
    });

    it('never stores passwords, e-mails, addresses or tokens', async () => {
        const { tokens, authorization } = await signedIn();
        await oauth.refresh(tokens.refresh_token);
        await oauth.refresh(tokens.refresh_token);
        await eventOf('token_reuse_detected');
        const stored = JSON.stringify(await events());
        for (const secret of [
            password,
            email,
            '127.0.0.1',
            tokens.refresh_token,
            authorization.code,
        ]) {
            assert.ok(!stored.includes(secret), secret);
        }
    });

    it('removes events older than ninety days', async () => {
        const old = new Date(Date.now() - 91 * 86400 * 1000);
        await env.database.prisma.auditEvent.create({
            data: { id: randomUUID(), type: 'logout', occurredAt: old },
        });
        await login('wrong');
        assert.deepEqual(await types(), ['login_failed']);
    });

    it('lets the login happen when the audit cannot be written', async () => {
        const schema = new URL(env.database.url).searchParams.get('schema');
        const rename = (from, to) =>
            env.database.prisma.$executeRawUnsafe(
                `ALTER TABLE "${schema}"."${from}" RENAME TO "${to}"`,
            );
        await rename('auth_audit_events', 'moved');
        try {
            assert.equal((await login()).response.status, 200);
        } finally {
            await rename('moved', 'auth_audit_events');
        }
    });
});
