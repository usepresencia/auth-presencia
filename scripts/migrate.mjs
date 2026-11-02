import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseConnection } from '../dist/shared/infrastructure/persistence/database.js';
import { runMigrations } from '../dist/shared/infrastructure/persistence/migrate.js';

if (existsSync('.env')) process.loadEnvFile();
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for explicit migrations.');
const database = new DatabaseConnection(process.env.DATABASE_URL);
try {
    const applied = await runMigrations(database, resolve('migrations'));
    console.log('Applied migrations:', applied.length ? applied.join(', ') : 'none');
} catch {
    console.error('Auth migrations failed. Review database connectivity and migration history.');
    process.exitCode = 1;
} finally {
    await database.onModuleDestroy();
}
