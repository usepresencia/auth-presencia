import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { buildTestApp, oauthClient } from './support/app.mjs';
import { Browser } from './support/browser.mjs';
import { projectId } from './support/firebase.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('FIRESTORE_EMULATOR_HOST is required: run these tests against the emulator.');
}
let env;
let oauth;
let firebase;
let firestore;

before(async () => {
    firebase = initializeApp({ projectId }, 'logs-' + randomUUID());
    firestore = getFirestore(firebase);
    env = await buildTestApp();
    oauth = oauthClient(env);
    env.gateway.addCredentials('uid-log', 'log@example.test', 'sensitive-password');
});
after(async () => {
    await env?.close();
    await deleteApp(firebase);
});

/** A mesma consulta da tela de Logs do web-admin-console. */
async function consoleEntries(correlationId) {
    for (let attempt = 0; attempt < 50; attempt++) {
        const snapshot = await firestore
            .collectionGroup('entries')
            .where('source', '==', 'api')
            .orderBy('timestamp', 'desc')
            .limit(50)
            .get();
        const found = snapshot.docs.filter(d => d.data().correlationId === correlationId);
        if (found.length > 0) return found;
        await setTimeout(100);
    }
    return [];
}

async function login(password, correlationId) {
    const client = new Browser();
    const started = await oauth.follow(client, oauth.authorizationRequest().url);
    return {
        uid: started.front.pathname.split('/')[2],
        response: await client.request(new URL(started.front.pathname + '/login', env.issuer), {
            method: 'POST',
            headers: {
                origin: env.issuer,
                'content-type': 'application/json',
                'x-correlation-id': correlationId,
            },
            body: JSON.stringify({ email: 'log@example.test', password }),
        }),
    };
}

describe('error log for the admin console', () => {
    it('records an unavailable login under its correlation id', async () => {
        const correlationId = randomUUID();
        env.gateway.down = true;
        let result;
        try {
            result = await login('sensitive-password', correlationId);
        } finally {
            env.gateway.down = false;
        }
        assert.equal(result.response.status, 503);
        const [entry] = await consoleEntries(correlationId);
        assert.ok(entry, 'entry not found');
        assert.equal(entry.ref.path, `logs/${correlationId}/entries/${entry.id}`);
        const data = entry.data();
        assert.equal(data.module, 'auth-presencia');
        assert.equal(data.level, 'error');
        assert.equal(data.code, 'AUTH_UNAVAILABLE');
        assert.equal(data.message, 'Error (AUTH_UNAVAILABLE)');
        assert.deepEqual(data.context, {
            method: 'POST',
            url: '/interaction/:uid/login',
            status: 503,
        });
        const stored = JSON.stringify(data);
        for (const secret of ['sensitive-password', 'log@example.test', result.uid]) {
            assert.ok(!stored.includes(secret), secret);
        }
    });

    it('records a server failure inside the protocol routes without changing the answer', async () => {
        const person = await env.person();
        const { body } = await oauth.exchange(await oauth.login(person.sub));
        const correlationId = randomUUID();
        env.gateway.down = true;
        let response;
        try {
            response = await fetch(env.issuer + '/token', {
                method: 'POST',
                headers: {
                    authorization:
                        'Basic ' +
                        Buffer.from('web-kontal:' + env.client.clientSecret).toString('base64'),
                    'x-correlation-id': correlationId,
                },
                body: new URLSearchParams({
                    grant_type: 'refresh_token',
                    refresh_token: body.refresh_token,
                }),
            });
        } finally {
            env.gateway.down = false;
        }
        assert.equal(response.status, 500);
        assert.equal((await response.json()).error, 'server_error');
        const [entry] = await consoleEntries(correlationId);
        assert.equal(entry?.data().code, 'INTERNAL_ERROR');
        assert.equal(entry.data().context.url, '/token');
        assert.ok(!JSON.stringify(entry.data()).includes(body.refresh_token));
    });

    it('does not record client errors nor the readiness probe', async () => {
        const correlationId = randomUUID();
        assert.equal((await login('wrong-password', correlationId)).response.status, 401);
        const probe = randomUUID();
        await fetch(env.issuer + '/health/ready', { headers: { 'x-correlation-id': probe } });
        await setTimeout(500);
        for (const id of [correlationId, probe]) {
            const stored = await firestore.collection('logs').doc(id).collection('entries').get();
            assert.equal(stored.size, 0);
        }
    });
});
