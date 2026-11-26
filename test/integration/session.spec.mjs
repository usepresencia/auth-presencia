import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { createSessionExtension } from '../../dist/modules/oidc/session-extension.js';
import { buildTestApp, oauthClient } from './support/app.mjs';
import { Browser } from './support/browser.mjs';

const day = 86400;
const now = () => Math.floor(Date.now() / 1000);
let env;
let oauth;

before(async () => {
    env = await buildTestApp();
    oauth = oauthClient(env);
});
after(async () => {
    await env?.close();
});

async function signedIn(extra) {
    const person = await env.person(undefined, extra);
    const authorization = await oauth.login(person.sub);
    const { status, body } = await oauth.exchange(authorization);
    assert.equal(status, 200, JSON.stringify(body));
    return { person, browser: authorization.browser, tokens: body };
}
const claims = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
const invalidGrant = result => {
    assert.equal(result.status, 400, JSON.stringify(result.body));
    assert.equal(result.body.error, 'invalid_grant');
};

async function sessionRow(sub) {
    const rows = await env.database.prisma.oidcArtifact.findMany({ where: { model: 'Session' } });
    return rows.find(row => row.payload.accountId === sub);
}

/** Envelhece a sessão no banco, junto da concessão e dos refresh tokens do mesmo login. */
async function ageSession(sub, { loginAgo, expiresIn }) {
    const row = await sessionRow(sub);
    const exp = now() + expiresIn;
    await env.database.prisma.oidcArtifact.update({
        where: { model_id: { model: 'Session', id: row.id } },
        data: {
            payload: { ...row.payload, loginTs: now() - loginAgo, exp },
            expiresAt: new Date(exp * 1000),
        },
    });
    const related = await env.database.prisma.oidcArtifact.findMany({
        where: { model: { in: ['Grant', 'RefreshToken'] } },
    });
    const absolute = now() - loginAgo + 14 * day;
    for (const item of related.filter(item => item.payload.accountId === sub)) {
        await env.database.prisma.oidcArtifact.update({
            where: { model_id: { model: item.model, id: item.id } },
            data: {
                payload: {
                    ...item.payload,
                    exp: absolute,
                    ...(item.model === 'RefreshToken' ? { authTime: now() - loginAgo } : {}),
                },
                expiresAt: new Date(absolute * 1000),
            },
        });
    }
}
/** Quanto resta ao refresh token mais novo (ainda não consumido) da pessoa. */
async function refreshRemaining(sub) {
    const rows = await env.database.prisma.oidcArtifact.findMany({
        where: { model: 'RefreshToken', consumedAt: null },
    });
    return rows.find(row => row.payload.accountId === sub).payload.exp - now();
}
const remaining = async sub => (await sessionRow(sub)).payload.exp - now();
const near = (actual, expected) =>
    assert.ok(Math.abs(actual - expected) < 60, actual + ' != ' + expected);

describe('refresh tokens', () => {
    it('rotates the refresh token and revokes the family on replay', async () => {
        const { tokens } = await signedIn();
        const rotated = await oauth.refresh(tokens.refresh_token);
        assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
        assert.notEqual(rotated.body.refresh_token, tokens.refresh_token);
        assert.equal(claims(rotated.body.access_token).aud, 'api-kontal');
        invalidGrant(await oauth.refresh(tokens.refresh_token));
        invalidGrant(await oauth.refresh(rotated.body.refresh_token));
    });

    it('allows at most one of two concurrent refreshes and kills the family', async () => {
        for (let round = 0; round < 5; round++) {
            const { tokens } = await signedIn();
            const results = await Promise.all([
                oauth.refresh(tokens.refresh_token),
                oauth.refresh(tokens.refresh_token),
            ]);
            const winners = results.filter(r => r.status === 200);
            assert.ok(winners.length <= 1, JSON.stringify(results));
            for (const loser of results.filter(r => r.status !== 200)) invalidGrant(loser);
            for (const winner of winners) {
                invalidGrant(await oauth.refresh(winner.body.refresh_token));
            }
        }
    });

    it('lets at most one of eight concurrent refreshes succeed', async () => {
        const { tokens } = await signedIn();
        const results = await Promise.all(
            Array.from({ length: 8 }, () => oauth.refresh(tokens.refresh_token)),
        );
        const winners = results.filter(r => r.status === 200);
        assert.ok(winners.length <= 1, JSON.stringify(results));
        for (const loser of results.filter(r => r.status !== 200)) invalidGrant(loser);
        for (const winner of winners) {
            invalidGrant(await oauth.refresh(winner.body.refresh_token));
        }
    });

    it('revokes the family on replay even while firebase is unavailable', async () => {
        const { tokens } = await signedIn();
        const rotated = await oauth.refresh(tokens.refresh_token);
        assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
        env.gateway.down = true;
        try {
            invalidGrant(await oauth.refresh(tokens.refresh_token));
        } finally {
            env.gateway.down = false;
        }
        invalidGrant(await oauth.refresh(rotated.body.refresh_token));
    });

    it('reloads firebase claims on refresh', async () => {
        const { person, tokens } = await signedIn();
        assert.equal(claims(tokens.access_token).platformRole, 'INTERNAL_ADMIN');
        person.user.customClaims = { kontalMemberships: [{ companyId: 'c', role: 'OWNER' }] };
        const { body } = await oauth.refresh(tokens.refresh_token);
        const access = claims(body.access_token);
        assert.equal(access.platformRole, undefined);
        assert.deepEqual(access.kontalMemberships, [{ companyId: 'c', role: 'OWNER' }]);
    });

    for (const [name, revoke] of [
        [
            'auth identity disabled',
            person =>
                env.database.prisma.identity.update({
                    where: { id: person.sub },
                    data: { status: 'disabled' },
                }),
        ],
        ['firebase user disabled', person => (person.user.disabled = true)],
        ['password changed after login', person => (person.user.validSince = now() + 5)],
    ]) {
        it('refuses refresh with invalid_grant when ' + name, async () => {
            const { person, tokens } = await signedIn();
            await revoke(person);
            invalidGrant(await oauth.refresh(tokens.refresh_token));
        });
    }

    it('asks for a new login when credentials were revoked after the session started', async () => {
        const { person, browser } = await signedIn();
        person.user.validSince = now() + 5;
        const again = await oauth.follow(browser, oauth.authorizationRequest().url);
        assert.ok(again.front?.pathname.startsWith('/interaction/'), String(again.callback));
    });

    it('keeps the refresh token usable after a gateway outage', async () => {
        const { tokens } = await signedIn();
        env.gateway.down = true;
        let failed;
        try {
            failed = await oauth.refresh(tokens.refresh_token);
        } finally {
            env.gateway.down = false;
        }
        assert.ok(failed.status >= 500, JSON.stringify(failed));
        const retried = await oauth.refresh(tokens.refresh_token);
        assert.equal(retried.status, 200, JSON.stringify(retried.body));
    });

    it('revokes a refresh token through /token/revocation', async () => {
        const { tokens } = await signedIn();
        const revoked = await oauth.post('/token/revocation', { token: tokens.refresh_token });
        assert.equal(revoked.status, 200);
        invalidGrant(await oauth.refresh(tokens.refresh_token));
    });
});

describe('session lifetime', () => {
    it('keeps the new refresh token when extending the session fails', async () => {
        const { tokens } = await signedIn();
        const schema = new URL(env.database.url).searchParams.get('schema');
        const run = sql => env.database.prisma.$executeRawUnsafe(sql);
        await run(`CREATE FUNCTION "${schema}".fail_session() RETURNS trigger LANGUAGE plpgsql
            AS $$ BEGIN RAISE EXCEPTION 'fixture outage'; END $$`);
        await run(`CREATE TRIGGER fail_session BEFORE UPDATE ON "${schema}".auth_oidc_artifacts
            FOR EACH ROW WHEN (NEW.model = 'Session')
            EXECUTE FUNCTION "${schema}".fail_session()`);
        let result;
        try {
            result = await oauth.refresh(tokens.refresh_token).catch(error => ({ error }));
        } finally {
            await run(`DROP TRIGGER fail_session ON "${schema}".auth_oidc_artifacts`);
            await run(`DROP FUNCTION "${schema}".fail_session()`);
        }
        assert.equal(result.status, 200, String(result.error ?? JSON.stringify(result.body)));
        assert.equal((await oauth.refresh(result.body.refresh_token)).status, 200);
    });

    it('keeps sessions without a login only for the interaction window', async () => {
        const rows = () =>
            env.database.prisma.oidcArtifact.findMany({ where: { model: 'Session' } });
        const known = new Set((await rows()).map(row => row.id));
        await endSession(new Browser());
        const created = (await rows()).filter(row => !known.has(row.id));
        assert.equal(created.length, 1);
        assert.ok(created[0].payload.exp - now() <= 600, String(created[0].payload.exp - now()));
    });

    it('does not overwrite a session change saved while it is being extended', async () => {
        const { person } = await signedIn();
        const row = await sessionRow(person.sub);
        const extend = createSessionExtension(env.database.prisma);
        const where = { model_id: { model: 'Session', id: row.id } };
        let extension;
        await env.database.prisma.$transaction(
            async transaction => {
                await transaction.oidcArtifact.update({
                    where,
                    data: { payload: { ...row.payload, state: { secret: 'pending-logout' } } },
                });
                // A renovação começa com a gravação acima ainda sem commit.
                extension = extend(row.payload.uid);
                await setTimeout(500);
            },
            { timeout: 5000 },
        );
        await extension;
        assert.deepEqual((await sessionRow(person.sub)).payload.state, {
            secret: 'pending-logout',
        });
    });

    it('starts with seven days and a refresh token capped at fourteen', async () => {
        const { person } = await signedIn();
        near(await remaining(person.sub), 7 * day);
        const rows = await env.database.prisma.oidcArtifact.findMany({
            where: { model: 'RefreshToken' },
        });
        const own = rows.find(row => row.payload.accountId === person.sub);
        assert.ok(own.payload.exp <= own.payload.authTime + 14 * day);
    });

    for (const [name, loginAgo, expected] of [
        ['renews the seven day window on refresh', day, 7 * day],
        ['keeps working after the seventh day', 8 * day, 6 * day],
        ['never extends the session past fourteen days', 13 * day, day],
    ]) {
        it(name, async () => {
            const { person, tokens } = await signedIn();
            await ageSession(person.sub, { loginAgo, expiresIn: 100 });
            const result = await oauth.refresh(tokens.refresh_token);
            assert.equal(result.status, 200, JSON.stringify(result.body));
            near(await remaining(person.sub), expected);
            near(await refreshRemaining(person.sub), 14 * day - loginAgo);
        });
    }

    it('refuses refresh once the session expired', async () => {
        const { person, tokens } = await signedIn();
        await ageSession(person.sub, { loginAgo: 14 * day, expiresIn: -10 });
        invalidGrant(await oauth.refresh(tokens.refresh_token));
    });
});

const form = (browser, path, parameters) =>
    browser.request(new URL(path, env.issuer), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', origin: env.issuer },
        body: new URLSearchParams(parameters).toString(),
    });
const endSession = (browser, parameters = {}) =>
    browser.request(new URL('/session/end?' + new URLSearchParams(parameters), env.issuer));
const details = browser => browser.request(new URL('/session/logout-details', env.issuer));
const bye = () => ({
    client_id: 'web-kontal',
    post_logout_redirect_uri: env.client.postLogoutRedirectUris[0],
    state: 'bye-state',
});

describe('logout through the front', () => {
    it('redirects end_session to the front /logout page without HTML', async () => {
        const { browser } = await signedIn();
        const response = await endSession(browser, bye());
        assert.equal(response.status, 303);
        assert.equal(response.headers.get('location'), '/logout');
        assert.ok(!(response.headers.get('content-type') ?? '').includes('html'));
        assert.equal(await response.text(), '');
    });

    it('ends the session, redirects to the registered post logout uri and blocks further refresh', async () => {
        const { browser, tokens } = await signedIn();
        await endSession(browser, bye());
        const info = await details(browser);
        assert.equal(info.status, 200);
        assert.equal(info.headers.get('cache-control'), 'no-store');
        const body = await info.json();
        assert.equal(body.clientId, 'web-kontal');
        assert.equal(body.action, '/session/end/confirm');
        const confirmed = await form(browser, body.action, { xsrf: body.xsrf, logout: 'yes' });
        const location = new URL(confirmed.headers.get('location'));
        assert.equal(location.origin + location.pathname, env.client.postLogoutRedirectUris[0]);
        assert.equal(location.searchParams.get('state'), 'bye-state');
        invalidGrant(await oauth.refresh(tokens.refresh_token));
        const again = await oauth.follow(browser, oauth.authorizationRequest().url);
        assert.ok(again.front?.pathname.startsWith('/interaction/'), String(again.callback));
    });

    it('returns the logout confirmation data only to the browser that started it', async () => {
        const { browser } = await signedIn();
        await endSession(browser, bye());
        const response = await details(new Browser());
        assert.equal(response.status, 410);
        assert.deepEqual(await response.json(), { code: 'LOGOUT_EXPIRED' });
    });

    it('answers LOGOUT_EXPIRED when no logout was started', async () => {
        const { browser } = await signedIn();
        assert.equal((await details(browser)).status, 410);
    });

    it('rejects a confirmation with a wrong xsrf', async () => {
        const { browser, tokens } = await signedIn();
        await endSession(browser, bye());
        const response = await form(browser, '/session/end/confirm', {
            xsrf: 'wrong',
            logout: 'yes',
        });
        assert.equal(response.headers.get('location'), '/error?error=invalid_request');
        assert.equal((await oauth.refresh(tokens.refresh_token)).status, 200);
    });

    it('rejects an unregistered post_logout_redirect_uri', async () => {
        const { browser } = await signedIn();
        const response = await endSession(browser, {
            ...bye(),
            post_logout_redirect_uri: 'https://untrusted.example.test/bye',
        });
        assert.equal(response.headers.get('location'), '/error?error=invalid_request');
    });

    it('answers protocol errors to non-browser requests without HTML', async () => {
        const response = await fetch(env.issuer + '/session/end/confirm', {
            method: 'POST',
            redirect: 'manual',
            headers: { accept: 'application/json' },
        });
        assert.equal(response.status, 400);
        assert.match(response.headers.get('content-type'), /application\/json/);
    });

    it('redirects to /logout/success when no post logout uri was given', async () => {
        const { browser } = await signedIn();
        await endSession(browser);
        const body = await (await details(browser)).json();
        const confirmed = await form(browser, body.action, { xsrf: body.xsrf, logout: 'yes' });
        const success = await browser.request(
            new URL(confirmed.headers.get('location'), env.issuer),
        );
        assert.equal(success.status, 303);
        assert.equal(success.headers.get('location'), '/logout/success');
    });

    it('lets another person sign in over a session without returning HTML', async () => {
        const first = await signedIn();
        const second = await env.person();
        const browser = first.browser;
        const request = oauth.authorizationRequest({ prompt: 'login' });
        const started = await oauth.follow(browser, request.url);
        const asked = await oauth.follow(
            browser,
            started.front.pathname + '/__finish?sub=' + second.sub,
        );
        assert.equal(asked.front?.pathname, '/logout', String(asked.response.status));
        assert.equal(asked.response.status, 303);
        assert.equal(await asked.response.text(), '');
        const info = await (await details(browser)).json();
        const confirmed = await form(browser, info.action, { xsrf: info.xsrf, logout: 'yes' });
        const finished = await oauth.follow(browser, confirmed.headers.get('location'));
        const tokens = await oauth.exchange({
            code: finished.callback.searchParams.get('code'),
            verifier: request.verifier,
        });
        assert.equal(tokens.status, 200, JSON.stringify(tokens.body));
        assert.equal(claims(tokens.body.access_token).sub, second.sub);
        invalidGrant(await oauth.refresh(first.tokens.refresh_token));
    });

    it('never returns HTML to a browser without a session', async () => {
        const browser = new Browser();
        const response = await endSession(browser, bye());
        assert.equal(response.status, 303);
        assert.equal(response.headers.get('location'), '/logout');
        assert.equal(await response.text(), '');
        const body = await (await details(browser)).json();
        const confirmed = await form(browser, body.action, { xsrf: body.xsrf, logout: 'yes' });
        assert.ok(
            confirmed.headers.get('location').startsWith(env.client.postLogoutRedirectUris[0]),
        );
    });
});
