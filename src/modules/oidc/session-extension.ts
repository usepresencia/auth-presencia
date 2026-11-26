import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../shared/infrastructure/persistence/prisma.service';
import { epochSeconds, sessionTtl } from './session-policy';

const ATTEMPTS = 3;

/**
 * Renova a janela ociosa quando o produto usa o refresh token. Só grava sobre o conteúdo que
 * leu: uma alteração ou um logout simultâneo nunca é desfeito.
 */
export function createSessionExtension(prisma: PrismaService): (uid: string) => Promise<void> {
    return async uid => {
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            const now = epochSeconds();
            const row = await prisma.oidcArtifact.findFirst({
                where: { model: 'Session', uid, expiresAt: { gt: new Date(now * 1000) } },
            });
            if (!row) return;
            const payload = row.payload as Prisma.JsonObject;
            const loginTs = payload['loginTs'];
            if (typeof loginTs !== 'number') return;
            const exp = now + sessionTtl(loginTs, now);
            const { count } = await prisma.oidcArtifact.updateMany({
                where: { model: 'Session', id: row.id, payload: { equals: payload } },
                data: { payload: { ...payload, exp }, expiresAt: new Date(exp * 1000) },
            });
            if (count === 1) return;
        }
    };
}
