import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { Pool } from 'pg';
import { DatabaseConnection } from '../../dist/shared/infrastructure/persistence/database.js';
import { runMigrations } from '../../dist/shared/infrastructure/persistence/migrate.js';
import { PostgresIdentityRepository } from '../../dist/modules/identity/infrastructure/postgres-identity.repository.js';
import { IdentityService } from '../../dist/modules/identity/application/identity.service.js';
import { IdentityDisabledError } from '../../dist/modules/identity/domain/identity.js';

const input = process.env.INTEGRATION_DATABASE_URL;
if (!input || !new URL(input).pathname.endsWith('_test')) {
    throw new Error(
        'INTEGRATION_DATABASE_URL must explicitly reference a dedicated *_test database.',
    );
}
const admin = new Pool({ connectionString: input });
const schema = 'auth_test_' + randomUUID().replaceAll('-', '');
assert.match(schema, /^[a-z0-9_]+$/);
const connection = new URL(input);
connection.searchParams.set('options', '-c search_path=' + schema);
const database = new DatabaseConnection(connection.toString());
const service = new IdentityService(new PostgresIdentityRepository(database));
const principal = {
    projectId: 'demo-presencia',
    uid: 'fixture-user',
    email: 'fixture@example.test',
    emailVerified: true,
};
const migrations = resolve('migrations');

before(async () => {
    await admin.query('CREATE SCHEMA "' + schema + '"');
    await runMigrations(database, migrations);
});

after(async () => {
    await database.onModuleDestroy();
    await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    await admin.end();
});

beforeEach(async () => {
    await database.transaction(client =>
        client.query('TRUNCATE auth_firebase_identities, auth_identities'),
    );
});

describe('PostgreSQL identity foundation', () => {
    it('concurrent first login produces one stable identity without orphan rows', async () => {
        const identities = await Promise.all(
            Array.from({ length: 16 }, () => service.resolveVerifiedFirebaseIdentity(principal)),
        );
        assert.equal(new Set(identities.map(i => i.id)).size, 1);
        assert.notEqual(identities[0].id, principal.uid);
        const result = await database.transaction(client =>
            client.query('SELECT count(*)::int AS count FROM auth_identities'),
        );
        assert.equal(result.rows[0].count, 1);
    });

    it('never merges by email or UID across Firebase projects', async () => {
        const first = await service.resolveVerifiedFirebaseIdentity(principal);
        const second = await service.resolveVerifiedFirebaseIdentity({
            ...principal,
            projectId: 'another-project',
        });
        const third = await service.resolveVerifiedFirebaseIdentity({
            ...principal,
            uid: 'another-user',
        });
        assert.equal(new Set([first.id, second.id, third.id]).size, 3);
    });

    it('denies disabled identities without creating replacements', async () => {
        const identity = await service.resolveVerifiedFirebaseIdentity(principal);
        await database.transaction(client =>
            client.query("UPDATE auth_identities SET status = 'disabled' WHERE id = $1", [
                identity.id,
            ]),
        );
        await assert.rejects(
            service.resolveVerifiedFirebaseIdentity(principal),
            IdentityDisabledError,
        );
        const result = await database.transaction(client =>
            client.query('SELECT count(*)::int AS count FROM auth_identities'),
        );
        assert.equal(result.rows[0].count, 1);
    });

    it('treats external UID as a parameter, including SQL-like characters', async () => {
        const value = { ...principal, uid: "fixture'; DROP TABLE auth_identities; --" };
        const first = await service.resolveVerifiedFirebaseIdentity(value);
        const second = await service.resolveVerifiedFirebaseIdentity(value);
        assert.equal(first.id, second.id);
    });

    it('rejects invalid principal input before writing any identity', async () => {
        await assert.rejects(service.resolveVerifiedFirebaseIdentity({ ...principal, uid: '' }));
        await assert.rejects(
            service.resolveVerifiedFirebaseIdentity({ ...principal, projectId: '../other' }),
        );
        const result = await database.transaction(client =>
            client.query('SELECT count(*)::int AS count FROM auth_identities'),
        );
        assert.equal(result.rows[0].count, 0);
    });

    it('rolls back a failed transaction', async () => {
        await assert.rejects(
            database.transaction(async client => {
                await client.query('INSERT INTO auth_identities (id) VALUES ($1)', [randomUUID()]);
                throw new Error('fixture rollback');
            }),
            /fixture rollback/,
        );
        const result = await database.transaction(client =>
            client.query('SELECT count(*)::int AS count FROM auth_identities'),
        );
        assert.equal(result.rows[0].count, 0);
    });

    it('migrations are idempotent and detect edits to applied files', async () => {
        assert.deepEqual(await runMigrations(database, migrations), []);
        const directory = await mkdtemp(join(tmpdir(), 'presencia-migration-'));
        try {
            const sql = await readFile(join(migrations, '001_identity.sql'), 'utf8');
            await writeFile(join(directory, '001_identity.sql'), sql + '\\n-- changed fixture\\n');
            await assert.rejects(
                runMigrations(database, directory),
                /applied migration was modified/,
            );
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    });
});
