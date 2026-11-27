import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { buildTestApp, oauthClient } from './support/app.mjs';
import { Browser } from './support/browser.mjs';

let env;
let oauth;
const credentials = { email: 'limit@example.test', password: 'right-password' };

before(async () => {
    env = await buildTestApp({ settings: { AUTH_TRUST_PROXY: 'true' } });
    oauth = oauthClient(env);
    env.gateway.addCredentials('uid-limit', credentials.email, credentials.password);
});
after(async () => {
    await env?.close();
});
beforeEach(async () => {
    await env.database.prisma.rateLimit.deleteMany();
});

async function start(origin) {
    const browser = new Browser({ origin });
    const started = await oauth.follow(browser, oauth.authorizationRequest().url);
    return { browser, path: started.front.pathname };
}
const post = (flow, action, body, ip = '203.0.113.10') =>
    flow.browser.request(new URL(flow.path + '/' + action, env.issuer), {
        method: 'POST',
        headers: {
            origin: env.issuer,
            'content-type': 'application/json',
            'x-forwarded-for': ip,
        },
        body: JSON.stringify(body),
    });
const wrong = { ...credentials, password: 'wrong' };
async function fail(flow, times, ip, body = wrong) {
    for (let i = 0; i < times; i++) assert.equal((await post(flow, 'login', body, ip)).status, 401);
}
const blocked = async (response, seconds) => {
    assert.equal(response.status, 429);
    assert.equal((await response.json()).code, 'TOO_MANY_ATTEMPTS');
    const wait = Number(response.headers.get('retry-after'));
    assert.ok(wait > seconds - 10 && wait <= seconds, String(wait));
};
const expireBlocks = () =>
    env.database.prisma.rateLimit.updateMany({
        where: { blockedUntil: { not: null } },
        data: { blockedUntil: new Date(Date.now() - 1000) },
    });

describe('login protection', () => {
    it('blocks after five wrong passwords without asking firebase again', async () => {
        const flow = await start();
        await fail(flow, 5);
        const calls = env.gateway.calls;
        await blocked(await post(flow, 'login', wrong), 60);
        await blocked(await post(flow, 'login', credentials), 60);
        assert.equal(env.gateway.calls, calls);
    });

    it('blocks longer when the abuse comes back', async () => {
        const flow = await start();
        await fail(flow, 5);
        await blocked(await post(flow, 'login', wrong), 60);
        await expireBlocks();
        await fail(flow, 5);
        await blocked(await post(flow, 'login', wrong), 300);
    });

    it('does not lock the person out for someone else guessing from another address', async () => {
        const flow = await start();
        await fail(flow, 5, '198.51.100.7');
        await blocked(await post(flow, 'login', wrong, '198.51.100.7'), 60);
        assert.equal((await post(flow, 'login', credentials, '203.0.113.99')).status, 200);
    });

    it('limits one address trying many e-mails', async () => {
        const flow = await start();
        for (let i = 0; i < 50; i++) {
            await fail(flow, 1, '192.0.2.1', { email: `p${i}@example.test`, password: 'x' });
        }
        await blocked(await post(flow, 'login', credentials, '192.0.2.1'), 60);
    });

    it('limits one e-mail guessed from many addresses', async () => {
        const flow = await start();
        for (let i = 0; i < 20; i++) await fail(flow, 1, '192.0.2.' + (i + 10));
        await blocked(await post(flow, 'login', wrong, '192.0.2.200'), 60);
    });

    it('clears the count after a successful login', async () => {
        await fail(await start(), 4);
        assert.equal((await post(await start(), 'login', credentials)).status, 200);
        await fail(await start(), 5);
    });

    it('does not count an outage as an attempt', async () => {
        const flow = await start();
        env.gateway.down = true;
        try {
            for (let i = 0; i < 8; i++) {
                assert.equal((await post(flow, 'login', credentials)).status, 503);
            }
        } finally {
            env.gateway.down = false;
        }
        assert.equal((await post(flow, 'login', credentials)).status, 200);
    });

    it('holds the limit under simultaneous attempts and across replicas', async () => {
        const second = await env.secondInstance();
        const flows = [await start(), await start(second.origin)];
        const results = await Promise.all(
            Array.from({ length: 12 }, (_, i) =>
                post(flows[i % 2], 'login', { ...wrong, password: 'wrong-' + i }),
            ),
        );
        assert.equal(results.filter(r => r.status === 401).length, 5);
        assert.equal(results.filter(r => r.status === 429).length, 7);
    });

    it('never stores e-mails or addresses in clear text', async () => {
        await fail(await start(), 1);
        const stored = JSON.stringify(await env.database.prisma.rateLimit.findMany());
        assert.ok(!stored.includes('limit@example.test'));
        assert.ok(!stored.includes('203.0.113.10'));
    });

    it('limits password reset requests', async () => {
        const flow = await start();
        const body = { email: credentials.email };
        for (let i = 0; i < 3; i++) {
            assert.equal((await post(flow, 'password-reset', body)).status, 204);
        }
        const sent = env.gateway.resets.length;
        await blocked(await post(flow, 'password-reset', body), 60);
        assert.equal(env.gateway.resets.length, sent);
    });
});

describe('token endpoint protection', () => {
    const bad = () =>
        oauth.post('/token', { grant_type: 'refresh_token', refresh_token: 'unknown' });

    it('blocks an address after repeated refusals, in the OAuth format', async () => {
        for (let i = 0; i < 30; i++) assert.equal((await bad()).status, 400);
        let result;
        for (let attempt = 0; attempt < 10; attempt++) {
            result = await bad();
            if (result.status === 429) break;
        }
        assert.equal(result.status, 429);
        assert.equal(result.body.error, 'temporarily_unavailable');
        await setTimeout(500);
    });

    it('never counts successful requests', async () => {
        const person = await env.person();
        let token = (await oauth.exchange(await oauth.login(person.sub))).body.refresh_token;
        for (let i = 0; i < 35; i++) {
            const result = await oauth.refresh(token);
            assert.equal(result.status, 200, JSON.stringify(result.body));
            token = result.body.refresh_token;
        }
        assert.equal(await env.database.prisma.rateLimit.count(), 0);
    });
});

describe('headers and readiness', () => {
    for (const path of ['/health/live', '/jwks', '/unknown']) {
        it('sends the security headers on ' + path, async () => {
            const response = await fetch(env.issuer + path);
            assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
            assert.equal(response.headers.get('x-frame-options'), 'DENY');
        });
    }

    it('is ready with the database migrated', async () => {
        const response = await fetch(env.issuer + '/health/ready');
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { status: 'ready', service: 'auth-presencia' });
    });

    it('is not ready when a table is missing', async () => {
        const schema = new URL(env.database.url).searchParams.get('schema');
        const rename = (from, to) =>
            env.database.prisma.$executeRawUnsafe(
                `ALTER TABLE "${schema}"."${from}" RENAME TO "${to}"`,
            );
        await rename('auth_rate_limits', 'moved');
        try {
            assert.equal((await fetch(env.issuer + '/health/ready')).status, 503);
        } finally {
            await rename('moved', 'auth_rate_limits');
        }
    });
});
