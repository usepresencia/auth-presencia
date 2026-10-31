import { randomUUID } from 'node:crypto';
import { DatabaseConnection } from '../../../shared/infrastructure/persistence/database';
import type { Identity, IdentityRepository, VerifiedFirebaseIdentity } from '../domain/identity';

interface IdentityRow {
    id: string;
    status: Identity['status'];
    email: string | null;
    email_verified: boolean;
    created_at: Date;
}

function mapIdentity(row: IdentityRow): Identity {
    return {
        id: row.id,
        status: row.status,
        email: row.email,
        emailVerified: row.email_verified,
        createdAt: row.created_at,
    };
}

export class PostgresIdentityRepository implements IdentityRepository {
    constructor(private readonly database: DatabaseConnection) {}

    async findOrCreate(principal: VerifiedFirebaseIdentity): Promise<Identity> {
        return this.database.transaction(async client => {
            // A lock for this external key prevents orphan identities under concurrent first login.
            await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
                JSON.stringify([principal.projectId, principal.uid]),
            ]);
            const existing = await client.query<IdentityRow>(
                `SELECT i.id, i.status, i.email, i.email_verified, i.created_at
                 FROM auth_firebase_identities f JOIN auth_identities i ON i.id = f.identity_id
                 WHERE f.firebase_project_id = $1 AND f.firebase_uid = $2`,
                [principal.projectId, principal.uid],
            );
            if (existing.rows[0]) return mapIdentity(existing.rows[0]);
            const inserted = await client.query<IdentityRow>(
                `INSERT INTO auth_identities (id, email, email_verified) VALUES ($1, $2, $3)
                 RETURNING id, status, email, email_verified, created_at`,
                [randomUUID(), principal.email ?? null, principal.emailVerified],
            );
            await client.query(
                'INSERT INTO auth_firebase_identities (firebase_project_id, firebase_uid, identity_id) VALUES ($1, $2, $3)',
                [principal.projectId, principal.uid, inserted.rows[0].id],
            );
            return mapIdentity(inserted.rows[0]);
        });
    }
}
