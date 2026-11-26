import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { errors, type Adapter, type AdapterPayload } from 'oidc-provider';
import type { PrismaService } from '../../shared/infrastructure/persistence/prisma.service';

/**
 * Modelos cujo id é uma credencial apresentada pelo client ou pelo navegador: só o hash é
 * gravado. O id de Interaction fica de fora porque já aparece na URL.
 */
const SECRET_ID_MODELS = new Set(['AuthorizationCode', 'RefreshToken', 'Session']);
/** Modelos que morrem com a concessão. Outros, como Interaction, apenas a referenciam. */
const GRANTABLE_MODELS = new Set([
    'AccessToken',
    'AuthorizationCode',
    'RefreshToken',
    'DeviceCode',
    'BackchannelAuthenticationRequest',
]);
const CLEANUP_BATCH = 100;

class PrismaAdapter implements Adapter {
    constructor(
        private readonly prisma: PrismaService,
        private readonly model: string,
    ) {}

    private key(id: string): string {
        return SECRET_ID_MODELS.has(this.model)
            ? createHash('sha256').update(id).digest('base64url')
            : id;
    }

    async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
        const { jti, ...rest } = payload;
        const stored = SECRET_ID_MODELS.has(this.model)
            ? rest
            : { ...withoutSessionCookie(rest), jti };
        const data = {
            payload: stored as Prisma.InputJsonObject,
            grantId: GRANTABLE_MODELS.has(this.model) ? (payload.grantId ?? null) : null,
            uid: payload.uid ?? null,
            userCode: payload.userCode ?? null,
            expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
        };
        const where = { model_id: { model: this.model, id: this.key(id) } };
        await this.removeExpired();
        // `consumedAt` fica de fora do update: regravar nunca devolve um artefato ao uso.
        await this.prisma.oidcArtifact.upsert({
            where,
            create: { model: this.model, id: this.key(id), ...data },
            update: data,
        });
    }

    async find(id: string): Promise<AdapterPayload | undefined> {
        const row = await this.prisma.oidcArtifact.findFirst({
            where: { model: this.model, id: this.key(id), ...notExpired() },
        });
        if (!row) return undefined;
        const payload = toPayload(row);
        return SECRET_ID_MODELS.has(this.model) ? { ...payload, jti: id } : payload;
    }

    async findByUid(uid: string): Promise<AdapterPayload | undefined> {
        const row = await this.prisma.oidcArtifact.findFirst({
            where: { model: this.model, uid, ...notExpired() },
        });
        return row ? toPayload(row) : undefined;
    }

    async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
        const row = await this.prisma.oidcArtifact.findFirst({
            where: { model: this.model, userCode, ...notExpired() },
        });
        return row ? toPayload(row) : undefined;
    }

    /** Consumo atômico. Quem perde a disputa é reuso: a concessão inteira é revogada. */
    async consume(id: string): Promise<void> {
        const where = { model: this.model, id: this.key(id) };
        const { count } = await this.prisma.oidcArtifact.updateMany({
            where: { ...where, consumedAt: null },
            data: { consumedAt: new Date() },
        });
        if (count === 1) return;
        const row = await this.prisma.oidcArtifact.findFirst({
            where,
            select: { grantId: true },
        });
        if (row?.grantId) {
            await this.prisma.oidcArtifact.deleteMany({
                where: {
                    OR: [{ grantId: row.grantId }, { model: 'Grant', id: row.grantId }],
                },
            });
        }
        throw new errors.InvalidGrant('artifact already consumed');
    }

    async destroy(id: string): Promise<void> {
        await this.prisma.oidcArtifact.deleteMany({
            where: { model: this.model, id: this.key(id) },
        });
    }

    async revokeByGrantId(grantId: string): Promise<void> {
        await this.prisma.oidcArtifact.deleteMany({ where: { grantId } });
    }

    private async removeExpired(): Promise<void> {
        const expired = await this.prisma.oidcArtifact.findMany({
            where: { model: this.model, expiresAt: { lte: new Date() } },
            select: { id: true },
            take: CLEANUP_BATCH,
        });
        if (expired.length === 0) return;
        await this.prisma.oidcArtifact.deleteMany({
            where: { model: this.model, id: { in: expired.map(row => row.id) } },
        });
    }
}

/** A interação guarda o id da sessão, que o provedor não relê: não é gravado. */
function withoutSessionCookie(payload: AdapterPayload): AdapterPayload {
    const session = payload['session'] as Record<string, unknown> | undefined;
    if (!session) return payload;
    const safe = Object.fromEntries(Object.entries(session).filter(([name]) => name !== 'cookie'));
    return { ...payload, session: safe };
}

function notExpired(): Prisma.OidcArtifactWhereInput {
    return { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] };
}

function toPayload(row: { payload: Prisma.JsonValue; consumedAt: Date | null }): AdapterPayload {
    const payload = row.payload as AdapterPayload;
    return row.consumedAt
        ? { ...payload, consumed: Math.floor(row.consumedAt.getTime() / 1000) }
        : payload;
}

/** Fábrica no formato esperado pela opção `adapter` do oidc-provider. */
export function createPrismaAdapter(prisma: PrismaService): (model: string) => Adapter {
    return model => new PrismaAdapter(prisma, model);
}
