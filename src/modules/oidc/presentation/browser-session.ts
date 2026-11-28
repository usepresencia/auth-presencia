import type { Request, Response } from 'express';
import type Provider from 'oidc-provider';
import { epochSeconds, SESSION_COOKIE, sessionTtl } from '../model/session-policy';

/**
 * Abre no navegador uma sessão nova para a conta, como a criada pelo login interativo. A
 * sessão anterior é destruída e as concessões dela são revogadas.
 */
export async function openBrowserSession(
    provider: Provider,
    request: Request,
    response: Response,
    accountId: string,
): Promise<void> {
    const context = provider.createContext(request, response);
    const previous = await provider.Session.get(context);
    const grants = Object.values(previous.authorizations ?? {}).flatMap(item =>
        item.grantId ? [item.grantId] : [],
    );
    await Promise.all(
        grants.flatMap(grantId => [
            provider.AccessToken.revokeByGrantId(grantId),
            provider.AuthorizationCode.revokeByGrantId(grantId),
            provider.RefreshToken.revokeByGrantId(grantId),
            provider.Grant.adapter.destroy(grantId),
        ]),
    );
    if (previous.accountId) await previous.destroy();

    const session = new provider.Session();
    const now = epochSeconds();
    session.loginAccount({ accountId, loginTs: now });
    const ttl = sessionTtl(now, now);
    await session.save(ttl);
    context.cookies.set(provider.cookieName('session'), session.jti, {
        ...SESSION_COOKIE,
        expires: new Date((now + ttl) * 1000),
    });
}
