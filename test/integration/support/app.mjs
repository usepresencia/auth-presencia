import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { Test } from '@nestjs/testing';
import { SignInError } from '../../../dist/modules/accounts/model/sign-in.error.js';
import { kontalClient, secret, signingKey } from '../../support/fixtures.mjs';
import { Browser } from './browser.mjs';
import { createTestDatabase } from './database.mjs';

async function freePort() {
    const server = createServer().listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

export function fakeGateway() {
    const users = new Map();
    return {
        users,
        down: false,
        failure: undefined,
        calls: 0,
        resets: [],
        passwords: new Map(),
        addCredentials(uid, email, password) {
            this.passwords.set(email, { uid, password });
            return this.add(uid, { email });
        },
        async signIn(email, password) {
            this.calls++;
            if (this.down || this.failure === 'AUTH_UNAVAILABLE') {
                throw new Error('firebase unavailable');
            }
            if (this.failure) throw new SignInError(this.failure);
            const known = this.passwords.get(email);
            if (known?.password !== password) throw new SignInError('INVALID_CREDENTIALS');
            return {
                projectId: 'demo-presencia',
                uid: known.uid,
                email,
                emailVerified: true,
            };
        },
        async sendPasswordReset(email) {
            this.calls++;
            this.resets.push(email);
        },
        add(uid, extra = {}) {
            users.set(uid, {
                uid,
                email: uid + '@example.test',
                emailVerified: true,
                name: 'Fixture Person',
                disabled: false,
                validSince: 0,
                customClaims: { platformRole: 'INTERNAL_ADMIN', hidden: 'no' },
                ...extra,
            });
            return users.get(uid);
        },
        async getUser(uid) {
            if (this.down) throw new Error('firebase unavailable');
            return users.get(uid) ?? null;
        },
    };
}

export async function buildTestApp({ gateway = fakeGateway() } = {}) {
    const database = await createTestDatabase();
    const port = await freePort();
    const issuer = 'http://127.0.0.1:' + port;
    const key = signingKey('integration');
    const client = kontalClient('http://127.0.0.1:1/callback', 'http://127.0.0.1:1/bye');
    Object.assign(process.env, {
        NODE_ENV: 'test',
        AUTH_ISSUER: issuer,
        DATABASE_URL: database.url,
        AUTH_JWKS: JSON.stringify({ keys: [key] }),
        AUTH_COOKIE_KEYS: secret(),
        AUTH_CLIENTS: JSON.stringify([client]),
        FIREBASE_PROJECT_ID: 'demo-presencia',
        FIREBASE_API_KEY: 'fake-api-key',
    });
    const dist = '../../../dist/';
    const { AppModule } = await import(dist + 'app.module.js');
    const { configureApp } = await import(dist + 'bootstrap.js');
    const { FIREBASE_GATEWAY } = await import(dist + 'modules/accounts/model/firebase.gateway.js');
    const { OIDC_PROVIDER } = await import(dist + 'modules/oidc/oidc.tokens.js');
    const { IdentityService } = await import(
        dist + 'modules/identity/application/identity.service.js'
    );

    const instances = [];
    async function start(listenPort) {
        const module = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(FIREBASE_GATEWAY)
            .useValue(gateway)
            .compile();
        const app = module.createNestApplication({ bodyParser: false, logger: false });
        const provider = app.get(OIDC_PROVIDER);
        app.use(async (req, res, next) => {
            const match = /^\/interaction\/[^/]+\/__finish\?sub=([^&]+)$/.exec(req.url);
            if (!match) return next();
            await provider.interactionFinished(
                req,
                res,
                { login: { accountId: match[1], remember: true } },
                { mergeWithLastSubmission: false },
            );
        });
        configureApp(app);
        await app.listen(listenPort, '127.0.0.1');
        const instance = { app, provider, origin: 'http://127.0.0.1:' + listenPort };
        instances.push(instance);
        return instance;
    }
    let primary = await start(port);

    return {
        issuer,
        client,
        gateway,
        database,
        get app() {
            return primary.app;
        },
        get provider() {
            return primary.provider;
        },
        async secondInstance() {
            return start(await freePort());
        },
        async restart() {
            await primary.app.close();
            instances.splice(instances.indexOf(primary), 1);
            primary = await start(port);
            for (let attempt = 0; attempt < 5; attempt++) {
                if (await fetch(issuer + '/health/live').catch(() => undefined)) return;
            }
            throw new Error('restarted application did not answer');
        },
        async person(uid = 'uid-' + secret().slice(0, 12), extra) {
            const user = gateway.add(uid, extra);
            const identity = await primary.app
                .get(IdentityService)
                .resolveVerifiedFirebaseIdentity({
                    projectId: 'demo-presencia',
                    uid,
                    email: user.email,
                    emailVerified: true,
                });
            return { sub: identity.id, uid, user };
        },
        async close() {
            for (const instance of instances) await instance.app.close();
            await database.drop();
        },
    };
}

export function oauthClient(env) {
    const redirectUri = env.client.redirectUris[0];

    function authorizationRequest(parameters = {}) {
        const verifier = secret();
        const state = secret();
        const nonce = secret();
        const url = new URL('/authorize', env.issuer);
        url.search = new URLSearchParams({
            client_id: env.client.clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: 'openid email profile api',
            state,
            nonce,
            code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            code_challenge_method: 'S256',
            ...parameters,
        });
        return { url, verifier, state, nonce };
    }

    async function follow(browser, start) {
        let url = new URL(start, env.issuer);
        for (let hop = 0; hop < 10; hop++) {
            const response = await browser.request(url);
            const location = response.headers.get('location');
            if (!location) return { response, url };
            url = new URL(location, url);
            if (url.href.startsWith(redirectUri)) return { response, callback: url };
            if (/^\/(interaction\/|error|logout)/.test(url.pathname))
                return { response, front: url };
        }
        throw new Error('redirect loop');
    }

    async function login(sub, { browser = new Browser(), parameters } = {}) {
        const request = authorizationRequest(parameters);
        const started = await follow(browser, request.url);
        assert.ok(started.front?.pathname.startsWith('/interaction/'), String(started.front));
        const finished = await follow(
            browser,
            started.front.pathname + '/__finish?sub=' + encodeURIComponent(sub),
        );
        assert.ok(finished.callback?.searchParams.get('code'), String(finished.callback));
        assert.equal(finished.callback.searchParams.get('state'), request.state);
        return { ...request, browser, code: finished.callback.searchParams.get('code') };
    }

    async function post(path, parameters, { clientSecret = env.client.clientSecret, origin } = {}) {
        const credentials = Buffer.from(env.client.clientId + ':' + clientSecret);
        const response = await fetch(new URL(path, origin ?? env.issuer), {
            method: 'POST',
            headers: {
                'content-type': 'application/x-www-form-urlencoded',
                authorization: 'Basic ' + credentials.toString('base64'),
            },
            body: new URLSearchParams(parameters),
        });
        const text = await response.text();
        return { status: response.status, body: text ? JSON.parse(text) : undefined };
    }

    const exchange = (authorization, overrides = {}, options) =>
        post(
            '/token',
            {
                grant_type: 'authorization_code',
                code: authorization.code,
                code_verifier: authorization.verifier,
                redirect_uri: redirectUri,
                ...overrides,
            },
            options,
        );
    const refresh = (token, options) =>
        post('/token', { grant_type: 'refresh_token', refresh_token: token }, options);

    return { authorizationRequest, follow, login, post, exchange, refresh, redirectUri };
}
