const assert = require('node:assert/strict');
const { existsSync, readFileSync } = require('node:fs');
const { describe, it } = require('node:test');

const read = path => readFileSync(path, 'utf8');
const ci = read('.github/workflows/ci.yaml');
const cd = read('.github/workflows/cd.yaml');
const release = () => {
    const start = ci.indexOf('\n    release:\n');
    assert.notEqual(start, -1, 'release job');
    return ci.slice(start);
};

describe('release on main', () => {
    it('runs only for pushes to main, after the build passes', () => {
        assert.match(release(), /needs: build\n/);
        assert.match(
            release(),
            /if: github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'\n/,
        );
    });

    it('may write the version commit and the tag, and only that job', () => {
        assert.match(release(), /permissions:\n +contents: write\n/);
        assert.match(ci, /^permissions:\n {4}contents: read\n/m);
        assert.match(release(), /npm run release\n +git push --follow-tags origin main\n/);
    });

    it('replaces the manual release workflow', () => {
        assert.equal(existsSync('.github/workflows/release.yml'), false);
    });

    it('writes a commit message like the other services, without skipping CI', () => {
        assert.equal(existsSync('.versionrc.json'), false);
    });

    it('keeps the generated changelog out of the format check', () => {
        assert.match(read('.prettierignore'), /^CHANGELOG\.md$/m);
    });
});

describe('deploy after CI', () => {
    it('is triggered by the CI of main', () => {
        assert.match(
            cd,
            /^on:\n {4}workflow_run:\n {8}workflows: \['CI'\]\n {8}branches: \[main\]\n {8}types: \[completed\]\n/m,
        );
        assert.match(ci, /^name: CI\n/);
    });

    it('requires a successful push, never a pull request', () => {
        assert.match(cd, /github\.event\.workflow_run\.conclusion == 'success'/);
        assert.match(cd, /github\.event\.workflow_run\.event == 'push'/);
    });

    it('publishes the commit that CI validated', () => {
        assert.match(cd, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
        assert.match(cd, /NEW_TAG: \$\{\{ github\.event\.workflow_run\.head_sha \}\}/);
        assert.doesNotMatch(cd, /github\.sha\b/);
    });
});
