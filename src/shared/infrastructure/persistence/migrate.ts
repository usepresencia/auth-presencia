import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseConnection } from './database';

/** Explicit, transactional migrations with a shared lock and immutable checksums. */
export async function runMigrations(
    database: DatabaseConnection,
    directory: string,
): Promise<string[]> {
    const files = (await readdir(directory))
        .filter(file => /^\d+_[a-z0-9_-]+\.sql$/.test(file))
        .sort();
    return database.transaction(async client => {
        await client.query('SELECT pg_advisory_xact_lock(717931911)');
        await client.query(`CREATE TABLE IF NOT EXISTS auth_schema_migrations (
            name text PRIMARY KEY,
            checksum text NOT NULL,
            applied_at timestamptz NOT NULL DEFAULT now()
        )`);
        const applied: string[] = [];
        for (const file of files) {
            const sql = await readFile(join(directory, file), 'utf8');
            const checksum = createHash('sha256').update(sql).digest('hex');
            const existing = await client.query<{ checksum: string }>(
                'SELECT checksum FROM auth_schema_migrations WHERE name = $1',
                [file],
            );
            if (existing.rows[0]) {
                if (existing.rows[0].checksum !== checksum)
                    throw new Error('An applied migration was modified: ' + file);
                continue;
            }
            await client.query(sql);
            await client.query(
                'INSERT INTO auth_schema_migrations (name, checksum) VALUES ($1, $2)',
                [file, checksum],
            );
            applied.push(file);
        }
        return applied;
    });
}
