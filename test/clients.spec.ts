import { describe, expect, it } from 'vitest';
import { validateEnvironment } from '../src/shared/config/environment';

type Client = Record<string, unknown>;
const base = (JSON.parse(process.env['AUTH_CLIENTS']!) as Client[])[0]!;
const second: Client = {
    ...base,
    clientId: 'web-presencia',
    clientSecret: 'b'.repeat(43),
    resource: 'urn:presencia:api-presencia',
    audience: 'api-presencia',
};
const load = (...clients: Client[]) =>
    validateEnvironment({ ...process.env, AUTH_CLIENTS: JSON.stringify(clients) });
const rejects = (message: RegExp, ...clients: Client[]) =>
    expect(() => load(...clients)).toThrow(message);

describe('client registration', () => {
    it('accepts two products with their own resources', () => {
        expect(load(base, second).AUTH_CLIENTS).toHaveLength(2);
    });

    it('accepts two clients of the same API', () => {
        const mobile = { ...second, resource: base['resource'], audience: base['audience'] };
        expect(load(base, mobile).AUTH_CLIENTS).toHaveLength(2);
    });

    it.each(['Web Kontal', 'a', 'web_kontal', '-web', 'x'.repeat(65)])(
        'rejects the client id %s',
        clientId => rejects(/clientId/, { ...base, clientId }),
    );

    it('rejects a shared client secret without echoing it', () => {
        const secret = base['clientSecret'] as string;
        const shared = { ...second, clientSecret: secret };
        rejects(/clientSecret repetido/, base, shared);
        expect(() => load(base, shared)).not.toThrow(secret);
    });

    it('rejects one resource with two audiences', () =>
        rejects(/resource e audience/, base, { ...second, resource: base['resource'] }));

    it('rejects one audience for two resources', () =>
        rejects(/resource e audience/, base, { ...second, audience: base['audience'] }));

    it('rejects an API audience equal to a client id, which would accept ID tokens', () =>
        rejects(/audience/, base, { ...second, audience: base['clientId'] }));

    it.each(['openid', 'api email', 'offline_access', ' ', 'api  '])(
        'rejects the API scope "%s"',
        scope => rejects(/scope/, { ...base, scope }),
    );

    it.each(['sub', 'aud', 'scope', 'client_id', 'email_verified', 'firebase_uid'])(
        'rejects the reserved firebase claim %s',
        claim => rejects(/firebaseClaims/, { ...base, firebaseClaims: [claim] }),
    );

    it('rejects a repeated redirect URI', () => {
        const uri = (base['redirectUris'] as string[])[0];
        rejects(/redirectUris/, { ...base, redirectUris: [uri, uri] });
    });
});
