export type AuditEventType =
    | 'login_succeeded'
    | 'login_failed'
    | 'password_reset_requested'
    | 'token_reuse_detected'
    | 'logout';

export interface AuditEvent {
    type: AuditEventType;
    identityId?: string;
    clientId?: string;
    correlationId?: string;
    reason?: string;
    email?: string;
    address?: string;
}

export interface StoredAuditEvent extends Omit<AuditEvent, 'email' | 'address'> {
    id: string;
    occurredAt: Date;
    emailHash?: string;
    addressHash?: string;
}

export interface AuditRepository {
    save(event: StoredAuditEvent): Promise<void>;
    removeBefore(cutoff: Date): Promise<void>;
}
