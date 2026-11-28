const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { describe, it } = require('node:test');

const read = path => readFileSync(path, 'utf8');
const json = path => JSON.parse(read(path));

describe('token contract', () => {
    const ci = read('.github/workflows/ci.yaml');

    it('pins the published version in its own folder', () => {
        const { dependencies } = json('test/contract/package.json');
        assert.match(dependencies['@usepresencia/auth'], /^\d+\.\d+\.\d+$/);
    });

    it('keeps the package and its token out of the production install', () => {
        const root = json('package.json');
        assert.equal(root.dependencies['@usepresencia/auth'], undefined);
        assert.equal(root.devDependencies['@usepresencia/auth'], undefined);
        assert.doesNotMatch(read('Dockerfile'), /npmrc|NODE_AUTH_TOKEN|test\/contract/);
    });

    it('installs it in CI with read access only, then runs the contract', () => {
        assert.match(ci, /packages: read\n/);
        const install = ci.indexOf('npm ci --prefix test/contract');
        assert.notEqual(install, -1);
        assert.ok(install < ci.indexOf('npm run test:contract'));
        assert.match(
            ci.slice(install, install + 200),
            /NODE_AUTH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/,
        );
    });
});
