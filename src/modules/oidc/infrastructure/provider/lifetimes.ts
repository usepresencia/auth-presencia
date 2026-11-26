import type { Configuration } from 'oidc-provider';
import { absoluteRemaining, epochSeconds, sessionTtl, TTL } from '../../model/session-policy';

function secondsUntilCap(since: number | undefined): number {
    const now = epochSeconds();
    return Math.max(1, absoluteRemaining(since ?? now, now));
}

export const lifetimes: Configuration['ttl'] = {
    AuthorizationCode: TTL.AuthorizationCode,
    AccessToken: TTL.AccessToken,
    IdToken: TTL.IdToken,
    Interaction: TTL.Interaction,
    Session: (_ctx, session) => {
        if (!session.accountId) return TTL.Interaction;
        const now = epochSeconds();
        return Math.max(1, sessionTtl(session.loginTs ?? now, now));
    },
    Grant: ctx => secondsUntilCap(ctx?.oidc.session?.loginTs),
    RefreshToken: (_ctx, token) => secondsUntilCap((token as { authTime?: number }).authTime),
};
