import Provider, { errors, type Adapter, type Configuration } from 'oidc-provider';
import type { Environment } from '../../../../shared/config/environment';
import type { AccountService } from '../../../accounts/application/account.service';
import type { ErrorReport } from '../../../errors/model/error-log';
import { TTL } from '../../model/session-policy';
import { accountSupport } from './accounts';
import { clientRegistry } from './client-registry';
import { redirectToFront } from './front-redirect';
import { loadGrant } from './grants';
import { registerHooks } from './hooks';
import { loginPolicy } from './interaction-policy';
import { lifetimes } from './lifetimes';

export type ProviderSettings = Pick<
    Environment,
    'AUTH_ISSUER' | 'AUTH_JWKS' | 'AUTH_COOKIE_KEYS' | 'AUTH_CLIENTS' | 'AUTH_TRUST_PROXY'
>;

/**
 * Cria o provedor OIDC com os clients configurados, sem telas próprias: login, logout e
 * erros são entregues ao front por redirecionamento.
 *
 * @param extendSession renova a sessão após o uso de um refresh token.
 * @param reportError recebe as falhas internas das rotas do protocolo.
 */
export function createProvider(
    env: ProviderSettings,
    adapter: (model: string) => Adapter,
    accounts: AccountService,
    extendSession: (uid: string) => Promise<void>,
    reportError: (report: ErrorReport) => void,
): Provider {
    const clientConfig = clientRegistry(env.AUTH_CLIENTS);

    const configuration: Configuration = {
        adapter,
        clients: env.AUTH_CLIENTS.map(client => ({
            client_id: client.clientId,
            client_secret: client.clientSecret,
            redirect_uris: client.redirectUris,
            post_logout_redirect_uris: client.postLogoutRedirectUris,
            response_types: ['code'],
            grant_types: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_method: 'client_secret_basic',
        })),
        responseTypes: ['code'],
        clientAuthMethods: ['client_secret_basic'],
        jwks: env.AUTH_JWKS,
        cookies: { keys: env.AUTH_COOKIE_KEYS },
        routes: { authorization: '/authorize' },
        scopes: ['openid', 'email', 'profile', 'offline_access'],
        claims: {
            openid: ['sub', 'firebase_uid', 'firebase_project'],
            email: ['email', 'email_verified'],
            profile: ['name'],
        },
        conformIdTokenClaims: false,
        pkce: { required: () => true },
        ttl: lifetimes,
        expiresWithSession: () => true,
        rotateRefreshToken: () => true,
        issueRefreshToken: (_ctx, client) => client.grantTypeAllowed('refresh_token'),
        interactions: {
            policy: loginPolicy(),
            url: (_ctx, interaction) => '/interaction/' + interaction.uid,
        },
        features: {
            devInteractions: { enabled: false },
            pushedAuthorizationRequests: { enabled: false },
            dPoP: { enabled: false },
            revocation: { enabled: true },
            rpInitiatedLogout: {
                enabled: true,
                logoutSource: ctx => redirectToFront(ctx, '/logout'),
                postLogoutSuccessSource: ctx => redirectToFront(ctx, '/logout/success'),
            },
            resourceIndicators: {
                enabled: true,
                defaultResource: (_ctx, client) => clientConfig(client.clientId).resource,
                useGrantedResource: () => true,
                getResourceServerInfo: (_ctx, resource, client) => {
                    const config = clientConfig(client.clientId);
                    if (resource !== config.resource) throw new errors.InvalidTarget();
                    return {
                        scope: config.scope,
                        audience: config.audience,
                        accessTokenFormat: 'jwt',
                        accessTokenTTL: TTL.AccessToken,
                        jwt: { sign: { alg: 'RS256' } },
                    };
                },
            },
        },
        loadExistingGrant: loadGrant(clientConfig),
        ...accountSupport(accounts, clientConfig),
        renderError(ctx, out) {
            redirectToFront(ctx, '/error?error=' + encodeURIComponent(out.error));
        },
    };

    const provider = new Provider(env.AUTH_ISSUER, configuration);
    provider.proxy = env.AUTH_TRUST_PROXY;
    registerHooks(provider, extendSession, reportError);
    return provider;
}
