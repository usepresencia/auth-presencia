import { createHash, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { errorName } from '../../../shared/utils/error-name';
import type { AuditEvent, AuditRepository } from '../model/audit-event';

const RETENTION_MS = 90 * 86400 * 1000;

const hash = (value: string) =>
    createHash('sha256').update(value.toLowerCase()).digest('base64url');

export class AuditService {
    constructor(private readonly repository: AuditRepository) {}

    /**
     * Grava o evento, com e-mail e endereço somente como hash, e remove os vencidos.
     * Nunca lança.
     */
    async record({ email, address, ...event }: AuditEvent): Promise<void> {
        const now = new Date();
        try {
            await this.repository.save({
                ...event,
                id: randomUUID(),
                occurredAt: now,
                ...(email ? { emailHash: hash(email) } : {}),
                ...(address ? { addressHash: hash(address) } : {}),
            });
            await this.repository.removeBefore(new Date(now.getTime() - RETENTION_MS));
        } catch (error) {
            Logger.warn(`Falha ao auditar ${event.type}: ${errorName(error)}`, 'AuditService');
        }
    }
}
