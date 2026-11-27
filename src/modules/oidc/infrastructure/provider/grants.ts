import type { Configuration } from 'oidc-provider';
import { epochSeconds, TTL } from '../../model/session-policy';
import type { ClientRegistry } from './client-registry';

const GRANT_TOLERANCE_SECONDS = 5;

/**
 * Concede os escopos sem tela de consentimento, reaproveitando a concessão apenas se ela
 * durar tanto quanto a sessão atual.
 */
export function loadGrant(clientConfig: ClientRegistry): Configuration['loadExistingGrant'] {
    return async ctx => {
        const client = ctx.oidc.client!;
        const session = ctx.oidc.session!;
        const grantId = session.grantIdFor(client.clientId);
        const existing = grantId ? await ctx.oidc.provider.Grant.find(grantId) : undefined;
        const loginTs = session.loginTs ?? epochSeconds();
        const coversSession =
            (existing?.exp ?? 0) >= loginTs + TTL.SessionAbsolute - GRANT_TOLERANCE_SECONDS;
        if (existing && coversSession) return existing;

        const config = clientConfig(client.clientId);
        const grant = new ctx.oidc.provider.Grant({
            accountId: session.accountId,
            clientId: client.clientId,
        });
        grant.addOIDCScope('openid email profile offline_access');
        grant.addResourceScope(config.resource, config.scope);
        await grant.save();
        return grant;
    };
}
