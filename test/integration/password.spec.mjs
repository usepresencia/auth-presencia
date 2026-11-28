import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { jwtClaims } from '../support/fixtures.mjs';
import { buildTestApp, oauthClient } from './support/app.mjs';
import { Browser } from './support/browser.mjs';

let env;
let oauth;

before(async () => {
    env = await buildTestApp();
    oauth = oauthClient(env);
});
after(async () => {
    await env?.close();
});
beforeEach(async () => {
    await env.database.prisma.rateLimit.deleteMany();
    await env.database.prisma.auditEvent.deleteMany();
});

let sequence = 0;
function invitee() {
    const id = ++sequence;
    const email = `invitee${id}@example.test`;
    env.gateway.add('uid-invitee-' + id, { email });
    return { email, uid: 'uid-invitee-' + id, code: env.gateway.passwordCode(email) };
}
const define = (browser, body, { origin = env.issuer } = {}) =>
    browser.request(new URL('/password/define', env.issuer), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
        body: JSON.stringify(body),
    });
const password = 'chosen-password-123';
const refused = async (response, status, code) => {
    assert.equal(response.status, status);
    assert.equal((await response.json()).code, code);
};
const authorize = async browser => {
    const request = oauth.authorizationRequest();
    return { request, result: await oauth.follow(browser, request.url) };
};
const events = () => env.database.prisma.auditEvent.findMany({ orderBy: { occurredAt: 'asc' } });

describe('first password with a one-time code', () => {
    it('saves the password and opens a session that authorizes a product', async () => {
        const person = invitee();
        const browser = new Browser();
        const response = await define(browser, { code: person.code, password });
        assert.equal(response.status, 204);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        const { request, result } = await authorize(browser);
        assert.ok(result.callback?.searchParams.get('code'), String(result.front));
        const { body } = await oauth.exchange({
            code: result.callback.searchParams.get('code'),
            verifier: request.verifier,
        });
        assert.equal(jwtClaims(body.access_token).firebase_uid, person.uid);
        assert.equal((await oauth.refresh(body.refresh_token)).status, 200);
    });

    it('sets the session cookie only for the server', async () => {
        const response = await define(new Browser(), { code: invitee().code, password });
        const cookie = response.headers.getSetCookie().find(line => line.startsWith('_session='));
        assert.match(cookie, /; httponly/i);
        assert.match(cookie, /; samesite=lax/i);
        assert.match(cookie, /; expires=/i);
    });

    it('accepts the code only once', async () => {
        const person = invitee();
        assert.equal((await define(new Browser(), { code: person.code, password })).status, 204);
        const again = new Browser();
        await refused(
            await define(again, { code: person.code, password: 'another-password-1' }),
            410,
            'PASSWORD_CODE_INVALID',
        );
        assert.ok((await authorize(again)).result.front, 'no session expected');
    });

    it('refuses an unknown code', async () => {
        await refused(
            await define(new Browser(), { code: 'unknown', password }),
            410,
            'PASSWORD_CODE_INVALID',
        );
    });

    it('refuses a weak password and keeps the code usable', async () => {
        const person = invitee();
        await refused(
            await define(new Browser(), { code: person.code, password: '1' }),
            400,
            'WEAK_PASSWORD',
        );
        assert.equal((await define(new Browser(), { code: person.code, password })).status, 204);
    });

    it('refuses a disabled account without opening a session', async () => {
        const person = invitee();
        env.gateway.users.get(person.uid).disabled = true;
        const browser = new Browser();
        await refused(
            await define(browser, { code: person.code, password }),
            403,
            'ACCOUNT_DISABLED',
        );
        assert.ok((await authorize(browser)).result.front);
    });

    it('ends the session of another person in the same browser', async () => {
        const first = await env.person();
        const { browser, ...authorization } = await oauth.login(first.sub);
        const { body } = await oauth.exchange(authorization);
        const second = invitee();
        assert.equal((await define(browser, { code: second.code, password })).status, 204);
        assert.equal((await oauth.refresh(body.refresh_token)).status, 400);
        const grants = await env.database.prisma.oidcArtifact.findMany({
            where: { model: 'Grant', payload: { path: ['accountId'], equals: first.sub } },
        });
        assert.deepEqual(grants, []);
        const { request, result } = await authorize(browser);
        const tokens = await oauth.exchange({
            code: result.callback.searchParams.get('code'),
            verifier: request.verifier,
        });
        assert.equal(jwtClaims(tokens.body.access_token).firebase_uid, second.uid);
    });

    for (const origin of [null, 'https://evil.example.test']) {
        it('rejects the Origin ' + origin + ' without using the code', async () => {
            const person = invitee();
            const calls = env.gateway.calls;
            await refused(
                await define(new Browser(), { code: person.code, password }, { origin }),
                403,
                'ORIGIN_NOT_ALLOWED',
            );
            assert.equal(env.gateway.calls, calls);
        });
    }

    for (const [name, body] of [
        ['no code', { password }],
        ['an empty password', { code: 'c', password: '' }],
        ['extra fields', { code: 'c', password, email: 'a@example.test' }],
        ['a huge code', { code: 'c'.repeat(600), password }],
    ]) {
        it('rejects ' + name, async () => {
            await refused(await define(new Browser(), body), 400, 'INVALID_REQUEST');
        });
    }

    it('limits attempts with invalid codes by address', async () => {
        for (let i = 0; i < 10; i++) {
            await define(new Browser(), { code: 'wrong-' + i, password });
        }
        const calls = env.gateway.calls;
        await refused(
            await define(new Browser(), { code: invitee().code, password }),
            429,
            'TOO_MANY_ATTEMPTS',
        );
        assert.equal(env.gateway.calls, calls);
    });

    it('does not count an outage or a success against the limit', async () => {
        env.gateway.down = true;
        try {
            for (let i = 0; i < 15; i++) {
                await refused(
                    await define(new Browser(), { code: 'c', password }),
                    503,
                    'AUTH_UNAVAILABLE',
                );
            }
        } finally {
            env.gateway.down = false;
        }
        for (let i = 0; i < 12; i++) {
            const response = await define(new Browser(), { code: invitee().code, password });
            assert.equal(response.status, 204);
        }
    });

    it('audits success and refusal without the password or the code', async () => {
        const person = invitee();
        await define(new Browser(), { code: 'unknown-code', password });
        await define(new Browser(), { code: person.code, password });
        const stored = await events();
        assert.deepEqual(
            stored.map(e => [e.type, e.reason]),
            [
                ['password_definition_failed', 'PASSWORD_CODE_INVALID'],
                ['password_defined', null],
            ],
        );
        assert.match(stored[1].identityId, /^[0-9a-f-]{36}$/);
        const text = JSON.stringify(stored);
        for (const secret of [password, person.code, 'unknown-code', person.email]) {
            assert.ok(!text.includes(secret), secret);
        }
    });
});
