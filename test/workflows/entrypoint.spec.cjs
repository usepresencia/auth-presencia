const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const { chmodSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { describe, it } = require('node:test');

function start({ url = 'postgresql://fixture@db/auth', migrationStatus = 0 } = {}) {
    const dir = mkdtempSync(join(tmpdir(), 'entrypoint-'));
    const log = join(dir, 'calls.log');
    writeFileSync(log, '');
    writeFileSync(
        join(dir, 'npx'),
        `#!/bin/sh\necho "npx $*" >> "${log}"\nexit ${migrationStatus}\n`,
    );
    chmodSync(join(dir, 'npx'), 0o755);
    const env = { PATH: dir + ':' + process.env.PATH, ...(url ? { DATABASE_URL: url } : {}) };
    const result = spawnSync('sh', ['entrypoint.sh', 'sh', '-c', `echo app >> "${log}"`], {
        env,
        encoding: 'utf8',
    });
    return { ...result, calls: readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) };
}

describe('container entrypoint', () => {
    it('applies pending migrations before starting the application', () => {
        const result = start();
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(result.calls, ['npx --no-install prisma migrate deploy', 'app']);
    });

    it('does not start the application when a migration fails', () => {
        const result = start({ migrationStatus: 1 });
        assert.notEqual(result.status, 0);
        assert.deepEqual(result.calls, ['npx --no-install prisma migrate deploy']);
    });

    it('requires DATABASE_URL without running anything', () => {
        const result = start({ url: '' });
        assert.notEqual(result.status, 0);
        assert.match(result.stdout + result.stderr, /DATABASE_URL/);
        assert.deepEqual(result.calls, []);
    });

    it('is the entrypoint of the runtime image', () => {
        const dockerfile = readFileSync('Dockerfile', 'utf8');
        const runtime = dockerfile.slice(dockerfile.indexOf('AS runtime'));
        assert.match(runtime, /^ENTRYPOINT \["\.\/entrypoint\.sh"\]$/m);
        assert.match(runtime, /^CMD \["node", "dist\/main\.js"\]$/m);
    });

    it('is stored as executable', () => {
        const mode = execFileSync('git', ['ls-files', '-s', 'entrypoint.sh'], { encoding: 'utf8' });
        assert.match(mode, /^100755 /);
    });
});
