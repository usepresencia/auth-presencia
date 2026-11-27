const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { describe, it } = require('node:test');

const workflow = readFileSync('.github/workflows/cd.yaml', 'utf8');
const position = text => {
    const index = workflow.indexOf(text);
    assert.notEqual(index, -1, text);
    return index;
};

describe('deploy workflow', () => {
    it('runs only when started by hand, from main', () => {
        assert.match(workflow, /^on:\n {4}workflow_dispatch:\n/m);
        assert.doesNotMatch(workflow, /^ {4}(push|workflow_run|schedule|pull_request):/m);
        position("if: github.ref == 'refs/heads/main'");
    });

    const last = text => (position(text), workflow.lastIndexOf(text));

    it('migrates the database before replacing the service', () => {
        assert.ok(position('npm run db:migrate') < last('docker compose up -d'));
    });

    it('checks readiness and restores the previous version on failure', () => {
        assert.ok(position('https://auth.presencia.com.br/health/ready') < last('restore'));
    });

    it('keeps the previous tag when the new image cannot be pulled or started', () => {
        position('if ! docker compose pull "$SERVICE"; then');
        position('if ! docker compose up -d --force-recreate "$SERVICE"; then');
    });
});
