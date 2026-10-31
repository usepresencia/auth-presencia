// Isolated protocol experiment. Fixture identity and memory persistence are test-only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash, randomBytes } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import Provider, { errors } from 'oidc-provider';
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify } from 'jose';

const clientId = 'poc-presencia';
const clientSecret = randomBytes(32).toString('base64url');
const redirectUri = 'http://127.0.0.1:3341/callback';
const resource = 'https://api.presencia.example.test';
const audience = 'api-presencia';
let server;
let provider;
let issuer;
let jwks;

class Browser {
    cookies = new Map();

    async get(url) {
        const path = new URL(url).pathname;
        const cookie = [...this.cookies.values()]
            .filter(
                c =>
                    path === c.path ||
                    path.startsWith(c.path.endsWith('/') ? c.path : c.path + '/'),
            )
            .map(c => c.value)
            .join('; ');
        const response = await fetch(url, { redirect: 'manual', headers: { cookie } });
        for (const header of response.headers.getSetCookie()) {
            const parts = header.split(';').map(part => part.trim());
            const value = parts[0];
            const name = value.slice(0, value.indexOf('='));
            const cookiePath = parts.find(part => /^path=/i.test(part))?.slice(5) || '/';
            const key = name + '|' + cookiePath;
            if (parts.some(part => /^max-age=0$/i.test(part))) this.cookies.delete(key);
            else this.cookies.set(key, { path: cookiePath, value });
        }
        return response;
    }

    async authorize(parameters = {}) {
        const verifier = randomBytes(32).toString('base64url');
        const state = randomBytes(24).toString('base64url');
        const nonce = randomBytes(24).toString('base64url');
        let url = new URL('/auth', issuer);
        url.search = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'openid profile email offline_access api:read',
            prompt: 'consent',
            state,
            nonce,
            resource,
            code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            code_challenge_method: 'S256',
            ...parameters,
        }).toString();
        for (let redirects = 0; redirects < 15; redirects++) {
            const response = await this.get(url);
            const location = response.headers.get('location');
            if (!location) return { response, verifier, state, nonce };
            url = new URL(location, url);
            if (url.origin === new URL(redirectUri).origin) {
                assert.equal(url.searchParams.get('state'), state);
                return { callback: url, verifier, state, nonce };
            }
            assert.equal(url.origin, issuer, 'Experiment must stay on loopback issuer');
        }
        throw new Error('Authorization redirect loop');
    }
}

async function token(parameters) {
    const response = await fetch(issuer + '/token', {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            authorization: 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
        },
        body: new URLSearchParams(parameters),
    });
    return { status: response.status, body: await response.json() };
}

async function authorizeCode() {
    const authorization = await new Browser().authorize();
    assert.ok(authorization.callback?.searchParams.get('code'), JSON.stringify(authorization));
    return authorization;
}

async function exchange(authorization, verifier = authorization.verifier) {
    return token({
        grant_type: 'authorization_code',
        code: authorization.callback.searchParams.get('code'),
        code_verifier: verifier,
        redirect_uri: redirectUri,
        resource,
    });
}

describe('oidc-provider local protocol proof', () => {
    before(async () => {
        const { privateKey } = await generateKeyPair('RS256', { extractable: true });
        const key = {
            ...(await exportJWK(privateKey)),
            kid: 'poc-ephemeral',
            alg: 'RS256',
            use: 'sig',
        };
        server = createServer(async (req, res) => {
            try {
                if (req.url.startsWith('/interaction/')) {
                    const details = await provider.interactionDetails(req, res);
                    let result;
                    if (details.prompt.name === 'login') {
                        result = { login: { accountId: 'usr_fixture', remember: true } };
                    } else if (details.prompt.name === 'consent') {
                        const grant = new provider.Grant({ accountId: 'usr_fixture', clientId });
                        grant.addOIDCScope('openid profile email offline_access');
                        grant.addResourceScope(resource, 'api:read');
                        result = { consent: { grantId: await grant.save() } };
                    } else throw new Error('Unexpected fixture interaction');
                    await provider.interactionFinished(req, res, result, {
                        mergeWithLastSubmission: details.prompt.name !== 'login',
                    });
                    return;
                }
                await provider.callback()(req, res);
            } catch (error) {
                res.statusCode = 500;
                res.end(error.message);
            }
        });
        server.listen(0, '127.0.0.1');
        await once(server, 'listening');
        issuer = 'http://127.0.0.1:' + server.address().port;
        provider = new Provider(issuer, {
            clients: [
                {
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uris: [redirectUri],
                    response_types: ['code'],
                    grant_types: ['authorization_code', 'refresh_token'],
                    token_endpoint_auth_method: 'client_secret_basic',
                },
            ],
            jwks: { keys: [key] },
            cookies: { keys: [randomBytes(32).toString('base64url')] },
            claims: { openid: ['sub'], email: ['email', 'email_verified'], profile: ['name'] },
            scopes: ['openid', 'profile', 'email', 'offline_access'],
            pkce: { required: () => true },
            rotateRefreshToken: () => true,
            expiresWithSession: () => true,
            ttl: {
                AuthorizationCode: 60,
                AccessToken: 600,
                Interaction: 600,
                Session: 1209600,
                Grant: 1209600,
                RefreshToken: 2592000,
                IdToken: 600,
            },
            interactions: {
                url: (_ctx, interaction) => issuer + '/interaction/' + interaction.uid,
            },
            features: {
                devInteractions: { enabled: false },
                revocation: { enabled: true },
                resourceIndicators: {
                    enabled: true,
                    getResourceServerInfo: (_ctx, requested) => {
                        if (requested !== resource) throw new errors.InvalidTarget();
                        return {
                            scope: 'api:read',
                            audience,
                            accessTokenFormat: 'jwt',
                            accessTokenTTL: 600,
                        };
                    },
                },
            },
            findAccount: async (_ctx, id) => ({
                accountId: id,
                claims: async () => ({
                    sub: id,
                    name: 'Fixture only',
                    email: 'fixture@example.test',
                    email_verified: true,
                }),
            }),
        });
        const discovery = await fetch(issuer + '/.well-known/openid-configuration').then(r =>
            r.json(),
        );
        jwks = createLocalJWKSet(await fetch(discovery.jwks_uri).then(r => r.json()));
    });

    after(async () => {
        server?.closeAllConnections();
        await new Promise(resolve => (server ? server.close(resolve) : resolve()));
    });

    it('exchanges PKCE code and validates separate audiences, nonce and token lifetime', async () => {
        const authorization = await authorizeCode();
        const result = await exchange(authorization);
        assert.equal(result.status, 200, JSON.stringify(result.body));
        const access = await jwtVerify(result.body.access_token, jwks, { issuer, audience });
        const identity = await jwtVerify(result.body.id_token, jwks, {
            issuer,
            audience: clientId,
        });
        assert.equal(identity.payload.sub, 'usr_fixture');
        assert.equal(identity.payload.nonce, authorization.nonce);
        assert.ok(access.payload.exp - access.payload.iat <= 600);
        await assert.rejects(
            jwtVerify(result.body.access_token, jwks, { issuer, audience: 'agendaflow' }),
        );
        await assert.rejects(jwtVerify(result.body.id_token, jwks, { issuer, audience }));
    });

    it('rejects a reused authorization code', async () => {
        const authorization = await authorizeCode();
        assert.equal((await exchange(authorization)).status, 200);
        const replay = await exchange(authorization);
        assert.equal(replay.status, 400);
        assert.equal(replay.body.error, 'invalid_grant');
    });

    it('rejects an incorrect PKCE verifier', async () => {
        const result = await exchange(await authorizeCode(), randomBytes(32).toString('base64url'));
        assert.equal(result.status, 400);
        assert.equal(result.body.error, 'invalid_grant');
    });

    it('requires PKCE even for a confidential client', async () => {
        const result = await new Browser().authorize({ code_challenge: '' });
        assert.equal(result.callback?.searchParams.get('error'), 'invalid_request');
        assert.equal(result.callback?.searchParams.get('code'), null);
    });

    it('rejects the plain PKCE method', async () => {
        const result = await new Browser().authorize({ code_challenge_method: 'plain' });
        assert.equal(result.callback?.searchParams.get('error'), 'invalid_request');
        assert.equal(result.callback?.searchParams.get('code'), null);
    });

    it('rejects an unregistered redirect without redirecting to it', async () => {
        const result = await new Browser().authorize({
            redirect_uri: 'https://untrusted.example.test/callback',
        });
        assert.equal(result.response.status, 400);
        assert.equal(result.response.headers.get('location'), null);
    });

    it('rejects an unknown resource', async () => {
        const result = await new Browser().authorize({ resource: 'https://unknown.example.test' });
        assert.equal(result.callback?.searchParams.get('error'), 'invalid_target');
        assert.equal(result.callback?.searchParams.get('code'), null);
    });

    it('rotates refresh tokens and revokes the family on replay', async () => {
        const initial = await exchange(await authorizeCode());
        assert.ok(initial.body.refresh_token, JSON.stringify(initial.body));
        const rotated = await token({
            grant_type: 'refresh_token',
            refresh_token: initial.body.refresh_token,
            resource,
        });
        assert.equal(rotated.status, 200, JSON.stringify(rotated.body));
        assert.notEqual(rotated.body.refresh_token, initial.body.refresh_token);
        assert.equal(
            (
                await token({
                    grant_type: 'refresh_token',
                    refresh_token: initial.body.refresh_token,
                    resource,
                })
            ).body.error,
            'invalid_grant',
        );
        assert.equal(
            (
                await token({
                    grant_type: 'refresh_token',
                    refresh_token: rotated.body.refresh_token,
                    resource,
                })
            ).body.error,
            'invalid_grant',
        );
    });
});
