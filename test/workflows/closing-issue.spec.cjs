const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { parseClosingIssue, closeLinkedIssue } = require('../../scripts/closing-issue.cjs');
const repository = 'usepresencia/auth-presencia';

function event(overrides = {}) {
    return {
        action: 'closed',
        pull_request: { merged: true, base: { ref: 'develop' }, body: 'Closes #6', ...overrides },
    };
}

describe('one issue per PR', () => {
    it('accepts one local or fully qualified reference', () => {
        const expected = { owner: 'usepresencia', repo: 'auth-presencia', issue_number: 6 };
        assert.deepEqual(parseClosingIssue('Closes #6', repository), expected);
        assert.deepEqual(
            parseClosingIssue('CLOSES usepresencia/auth-presencia#6', repository),
            expected,
        );
    });

    it('ignores examples in fences, comments, HTML code and indented code', () => {
        const body = [
            '<!-- Closes #99 -->',
            '<pre>Closes #98</pre>',
            '```text',
            'Closes #97',
            '```',
            '    Closes #96',
            'Closes #6',
        ].join('\n');
        assert.equal(parseClosingIssue(body, repository).issue_number, 6);
    });

    for (const body of [
        '',
        'Closes #6\nCloses #7',
        'Closes #6, #7',
        'Closes #0',
        'Closes other/repository#6',
        'Closes #99999999999999999999',
    ]) {
        it('rejects missing, ambiguous or unauthorized directive: ' + body, () => {
            assert.throws(() => parseClosingIssue(body, repository));
        });
    }
});

describe('closure after maintainer merge', () => {
    it('closes exactly the referenced issue after merge into develop', async () => {
        const calls = [];
        const result = await closeLinkedIssue({
            payload: event(),
            repository,
            getIssue: async ref => {
                calls.push(['get', ref]);
                return { state: 'open' };
            },
            closeIssue: async ref => calls.push(['close', ref]),
        });
        assert.equal(result, 'closed');
        assert.equal(calls.length, 2);
        assert.deepEqual(calls[1][1], {
            owner: 'usepresencia',
            repo: 'auth-presencia',
            issue_number: 6,
            state: 'closed',
            state_reason: 'completed',
        });
    });

    for (const overrides of [{ merged: false }, { base: { ref: 'main' } }]) {
        it('does not close issues for an unmerged PR or another branch', async () => {
            assert.equal(
                await closeLinkedIssue({
                    payload: event(overrides),
                    repository,
                    getIssue: async () => assert.fail('must not read issue'),
                    closeIssue: async () => assert.fail('must not close issue'),
                }),
                'skipped',
            );
        });
    }

    it('does not close a PR presented as an issue', async () => {
        await assert.rejects(
            closeLinkedIssue({
                payload: event(),
                repository,
                getIssue: async () => ({ state: 'open', pull_request: {} }),
                closeIssue: async () => assert.fail('must not close PR'),
            }),
            /not a pull request/,
        );
    });

    it('is idempotent for an already closed issue', async () => {
        assert.equal(
            await closeLinkedIssue({
                payload: event(),
                repository,
                getIssue: async () => ({ state: 'closed' }),
                closeIssue: async () => assert.fail('must not update closed issue'),
            }),
            'already-closed',
        );
    });
});
