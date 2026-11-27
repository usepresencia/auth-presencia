const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { describe, it } = require('node:test');

const compose = readFileSync('deploy/auth-presencia.compose.yaml', 'utf8');
const label = name => {
    const line = compose.split('\n').find(item => item.includes(name + '='));
    assert.ok(line, name);
    return line.slice(line.indexOf(name + '=') + name.length + 1).replace(/'$/, '');
};
const rule = () => label('traefik.http.routers.auth-api.rule');
const patterns = () =>
    [...rule().matchAll(/PathRegexp\(`([^`]+)`\)/g)].map(
        match => new RegExp(match[1].replaceAll('$$', () => '$')),
    );
const toApi = path => patterns().some(pattern => pattern.test(path));

describe('traefik routing', () => {
    it('publishes the host over TLS on the service port', () => {
        assert.match(rule(), /^Host\(`auth\.presencia\.com\.br`\) && \(/);
        assert.equal(label('traefik.http.routers.auth-api.entrypoints'), 'websecure');
        assert.equal(label('traefik.http.routers.auth-api.tls.certresolver'), 'letsencrypt');
        assert.equal(label('traefik.http.services.auth-api.loadbalancer.server.port'), '3340');
    });

    it('quotes the healthcheck script, which YAML would read as a mapping', () => {
        assert.match(compose, /^ +- "fetch\(.*process\.exit.*"$/m);
    });

    for (const path of [
        '/.well-known/openid-configuration',
        '/jwks',
        '/authorize',
        '/authorize/abc',
        '/token',
        '/token/revocation',
        '/session/end',
        '/session/end/confirm',
        '/session/logout-details',
        '/interaction/abc/details',
        '/interaction/abc/login',
        '/health/ready',
    ]) {
        it('sends ' + path + ' to the api', () => assert.equal(toApi(path), true));
    }

    for (const path of [
        '/',
        '/interaction/abc',
        '/interaction/abc/',
        '/logout',
        '/logout/success',
        '/error',
        '/tokens',
        '/sessions',
        '/assets/app.js',
    ]) {
        it('leaves ' + path + ' to the front', () => assert.equal(toApi(path), false));
    }
});
