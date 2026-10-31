import { Pool, type PoolClient } from 'pg';
import { Logger, type OnModuleDestroy } from '@nestjs/common';

export class AuthDatabaseNotConfiguredError extends Error {
    constructor() {
        super('Auth identity database is not configured.');
        this.name = 'AuthDatabaseNotConfiguredError';
    }
}

/** Shared pool; no schema changes or network calls are made by construction. */
export class DatabaseConnection implements OnModuleDestroy {
    private readonly pool?: Pool;

    constructor(connectionString?: string) {
        if (connectionString) {
            this.pool = new Pool({
                connectionString,
                application_name: 'auth-presencia',
                max: 10,
                connectionTimeoutMillis: 5000,
                statement_timeout: 10000,
                query_timeout: 15000,
            });
            // Idle socket errors must not become unhandled EventEmitter exceptions.
            // Operation failures still propagate to callers; do not log connection secrets.
            this.pool.on('error', () =>
                Logger.error('Idle PostgreSQL connection failed.', 'DatabaseConnection'),
            );
        }
    }

    async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
        if (!this.pool) throw new AuthDatabaseNotConfiguredError();
        const client = await this.pool.connect();
        let destroy = false;
        try {
            await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
            const result = await operation(client);
            await client.query('COMMIT');
            return result;
        } catch (error) {
            try {
                await client.query('ROLLBACK');
            } catch {
                destroy = true;
            }
            throw error;
        } finally {
            client.release(destroy);
        }
    }

    async onModuleDestroy(): Promise<void> {
        await this.pool?.end();
    }
}
