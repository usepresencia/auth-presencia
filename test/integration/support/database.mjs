// Banco de teste isolado: schema aleatório com as migrations reais; nada fora dele é tocado.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { PrismaService } from '../../../dist/shared/infrastructure/persistence/prisma.service.js';

export function migrate(url) {
    return execFileSync('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], {
        env: { ...process.env, DATABASE_URL: url },
        encoding: 'utf8',
        stdio: 'pipe',
    });
}

export async function createTestDatabase() {
    const input = process.env.INTEGRATION_DATABASE_URL;
    if (!input || !new URL(input).pathname.endsWith('_test')) {
        throw new Error(
            'INTEGRATION_DATABASE_URL must explicitly reference a dedicated *_test database.',
        );
    }
    const schema = 'auth_test_' + randomUUID().replaceAll('-', '');
    assert.match(schema, /^[a-z0-9_]+$/);
    const target = new URL(input);
    target.searchParams.set('schema', schema);
    const url = target.toString();
    migrate(url);

    const connect = () => new PrismaService({ get: () => url });
    const prisma = connect();
    return {
        url,
        prisma,
        connect,
        async drop() {
            await prisma.$disconnect();
            const admin = new Pool({ connectionString: input });
            await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
            await admin.end();
        },
    };
}
