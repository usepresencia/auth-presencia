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

    it('leaves migrations to the container entrypoint', () => {
        assert.doesNotMatch(workflow, /db:migrate|migrate deploy/);
    });

    it('checks readiness and restores the previous version on failure', () => {
        assert.ok(position('https://auth.presencia.com.br/health/ready') < last('restore'));
    });

    it('keeps the previous tag when the new image cannot be pulled or started', () => {
        position('if ! compose pull "$SERVICE"; then');
        position('if ! compose up -d --force-recreate "$SERVICE"; then');
    });

    it('uses the single env file of the service, in /srv/auth', () => {
        position('cd /srv/auth/\n');
        position('SERVICE="auth-presencia"');
        position('ENV_FILE=".env.auth-presencia"\n');
        position('s/^AUTH_PRESENCIA_TAG=.*/AUTH_PRESENCIA_TAG=$NEW_TAG/');
        position('compose() { docker compose --env-file "$ENV_FILE" "$@"; }');
        assert.doesNotMatch(workflow, /^ +(if ! )?docker compose (pull|up|run)/m);
    });
});
