import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { buildTestApp, oauthClient } from './support/app.mjs';
import { Browser } from './support/browser.mjs';

let env;
let oauth;
let person;

before(async () => {
    env = await buildTestApp();
    oauth = oauthClient(env);
    person = await env.person();
});
after(async () => {
    await env?.close();
});

const json = async path => (await fetch(new URL(path, env.issuer))).json();

describe('authorization code flow', () => {
    it('publishes discovery with /authorize, /token, /jwks and S256 only', async () => {
        const discovery = await json('/.well-known/openid-configuration');
        assert.equal(discovery.issuer, env.issuer);
        assert.equal(discovery.authorization_endpoint, env.issuer + '/authorize');
        assert.equal(discovery.token_endpoint, env.issuer + '/token');
        assert.equal(discovery.jwks_uri, env.issuer + '/jwks');
        assert.deepEqual(discovery.code_challenge_methods_supported, ['S256']);
        const keys = (await json('/jwks')).keys;
        assert.equal(keys[0].kid, 'integration');
        assert.equal(keys[0].d, undefined);
    });

    it('advertises only what the api accepts', async () => {
        const discovery = await json('/.well-known/openid-configuration');
        assert.deepEqual(discovery.response_types_supported, ['code']);
        assert.deepEqual(discovery.response_modes_supported, ['query']);
        assert.deepEqual([...discovery.grant_types_supported].sort(), [
            'authorization_code',
            'refresh_token',
        ]);
        assert.deepEqual(discovery.token_endpoint_auth_methods_supported, ['client_secret_basic']);
        assert.equal(discovery.pushed_authorization_request_endpoint, undefined);
        assert.equal(discovery.dpop_signing_alg_values_supported, undefined);
    });

    it('does not offer userinfo, which would refuse every token of this service', async () => {
        const discovery = await json('/.well-known/openid-configuration');
        assert.equal(discovery.userinfo_endpoint, undefined);
        assert.equal(discovery.userinfo_signing_alg_values_supported, undefined);
        const response = await fetch(env.issuer + '/me');
        assert.equal(response.status, 404);
    });

    it('logs only the error name when a request fails outside the protocol routes', async () => {
        const { provider } = await env.secondInstance();
        provider.use(() => {
            throw new TypeError('sensitive-fixture-detail');
        });
        const server = createServer(provider.callback()).listen(0, '127.0.0.1');
        await once(server, 'listening');
        const printed = [];
        const original = console.error;
        console.error = (...parts) => printed.push(parts.join(' '));
        try {
            const response = await fetch('http://127.0.0.1:' + server.address().port + '/jwks');
            assert.equal(response.status, 500);
        } finally {
            console.error = original;
            server.close();
        }
        assert.ok(!printed.join('\n').includes('sensitive-fixture-detail'), printed.join('\n'));
    });

    it('issues an api-kontal access token and a web-kontal id token', async () => {
        const authorization = await oauth.login(person.sub);
        const { status, body } = await oauth.exchange(authorization);
        assert.equal(status, 200, JSON.stringify(body));
        const keys = createLocalJWKSet(await json('/jwks'));
        const access = await jwtVerify(body.access_token, keys, {
            issuer: env.issuer,
            audience: 'api-kontal',
            typ: 'at+jwt',
        });
        assert.equal(access.payload.sub, person.sub);
        assert.equal(access.payload.client_id, 'web-kontal');
        assert.equal(access.payload.firebase_uid, person.uid);
        assert.equal(access.payload.firebase_project, 'demo-presencia');
        assert.equal(access.payload.email, person.user.email);
        assert.equal(access.payload.email_verified, true);
        assert.equal(access.payload.name, 'Fixture Person');
        assert.equal(access.payload.platformRole, 'INTERNAL_ADMIN');
        assert.equal(access.payload.hidden, undefined);
        assert.equal(access.payload.kontalMemberships, undefined);
        assert.ok(access.payload.exp - access.payload.iat <= 600);

        const id = await jwtVerify(body.id_token, keys, {
            issuer: env.issuer,
            audience: 'web-kontal',
        });
        assert.equal(id.payload.sub, person.sub);
        assert.equal(id.payload.nonce, authorization.nonce);
        assert.equal(id.payload.firebase_uid, person.uid);
        assert.equal(id.payload.email, person.user.email);
        assert.equal(id.payload.name, 'Fixture Person');
        await assert.rejects(jwtVerify(body.id_token, keys, { audience: 'api-kontal' }));
    });

    it('returns a refresh token without prompt=consent or offline_access', async () => {
        const { body } = await oauth.exchange(await oauth.login(person.sub));
        assert.equal(typeof body.refresh_token, 'string');
    });

    it('reuses the session without a new login or consent screen', async () => {
        const first = await oauth.login(person.sub);
        const again = await oauth.follow(first.browser, oauth.authorizationRequest().url);
        assert.ok(again.callback?.searchParams.get('code'), String(again.front));
    });

    it('sends the login interaction to /interaction/:uid with a cookie scoped to that path', async () => {
        const browser = new Browser();
        const started = await oauth.follow(browser, oauth.authorizationRequest().url);
        assert.match(started.front.pathname, /^\/interaction\/[A-Za-z0-9_-]+$/);
        assert.equal(started.front.origin, env.issuer);
        const cookie = [...browser.cookies.values()].find(c => c.value.startsWith('_interaction='));
        assert.equal(cookie.path, started.front.pathname);
        assert.ok(cookie.attributes.some(a => /^httponly$/i.test(a)));
        assert.ok(cookie.attributes.some(a => /^samesite=lax$/i.test(a)));
    });

    it('rejects a reused authorization code', async () => {
        const authorization = await oauth.login(person.sub);
        assert.equal((await oauth.exchange(authorization)).status, 200);
        const replay = await oauth.exchange(authorization);
        assert.equal(replay.body.error, 'invalid_grant');
    });

    it('rejects a wrong PKCE verifier', async () => {
        const result = await oauth.exchange(await oauth.login(person.sub), {
            code_verifier: 'w'.repeat(43),
        });
        assert.equal(result.body.error, 'invalid_grant');
    });

    it('rejects a wrong client secret', async () => {
        const authorization = await oauth.login(person.sub);
        const result = await oauth.exchange(authorization, {}, { clientSecret: 'x'.repeat(43) });
        assert.equal(result.status, 401);
        assert.equal(result.body.error, 'invalid_client');
    });

    for (const [name, parameters, error] of [
        ['missing PKCE', { code_challenge: '' }, 'invalid_request'],
        ['plain PKCE', { code_challenge_method: 'plain' }, 'invalid_request'],
        ['an unknown resource', { resource: 'urn:presencia:other' }, 'invalid_target'],
    ]) {
        it('rejects ' + name, async () => {
            const result = await oauth.follow(
                new Browser(),
                oauth.authorizationRequest(parameters).url,
            );
            assert.equal(result.callback?.searchParams.get('error'), error);
            assert.equal(result.callback.searchParams.get('code'), null);
        });
    }

    it('sends an unregistered redirect_uri to the front /error page, never to that uri', async () => {
        const { url } = oauth.authorizationRequest({
            redirect_uri: 'https://untrusted.example.test/callback',
        });
        const response = await new Browser().request(url);
        assert.equal(response.status, 303);
        assert.equal(response.headers.get('location'), '/error?error=invalid_redirect_uri');
        assert.ok(!(response.headers.get('content-type') ?? '').includes('html'));
        assert.equal(await response.text(), '');
    });

    it('puts only the error code in the /error query string', async () => {
        const { url } = oauth.authorizationRequest({ client_id: '<script>alert(1)</script>' });
        const response = await new Browser().request(url);
        assert.match(response.headers.get('location'), /^\/error\?error=[a-z_]+$/);
    });

    for (const mode of ['form_post', 'fragment']) {
        it('rejects response_mode=' + mode + ' without returning HTML', async () => {
            const { url } = oauth.authorizationRequest({ response_mode: mode });
            const response = await new Browser().request(url);
            assert.equal(response.status, 400);
            assert.match(response.headers.get('content-type'), /application\/json/);
            assert.equal((await response.json()).error, 'invalid_request');
        });
    }

    it('rejects authorization requests sent by POST', async () => {
        const { url } = oauth.authorizationRequest();
        const response = await fetch(env.issuer + '/authorize', {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: url.searchParams + '&response_mode=form_post',
        });
        assert.equal(response.status, 405);
    });

    it('completes on a second instance a login started on the first', async () => {
        const browser = new Browser();
        const request = oauth.authorizationRequest();
        const started = await oauth.follow(browser, request.url);
        const second = await env.secondInstance();
        browser.origin = second.origin;
        const response = await browser.request(
            new URL(started.front.pathname + '/__finish?sub=' + person.sub, env.issuer),
        );
        let url = new URL(response.headers.get('location'), env.issuer);
        while (!url.href.startsWith(oauth.redirectUri)) {
            const next = await browser.request(url);
            url = new URL(next.headers.get('location'), url);
        }
        const result = await oauth.exchange(
            { code: url.searchParams.get('code'), verifier: request.verifier },
            {},
            { origin: second.origin },
        );
        assert.equal(result.status, 200, JSON.stringify(result.body));
    });

    it('completes a login after the app restarts', async () => {
        const browser = new Browser();
        const request = oauth.authorizationRequest();
        const started = await oauth.follow(browser, request.url);
        await env.restart();
        const finished = await oauth.follow(
            browser,
            started.front.pathname + '/__finish?sub=' + person.sub,
        );
        const result = await oauth.exchange({
            code: finished.callback.searchParams.get('code'),
            verifier: request.verifier,
        });
        assert.equal(result.status, 200, JSON.stringify(result.body));
    });
});
