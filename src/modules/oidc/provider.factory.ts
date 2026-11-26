import { Logger } from '@nestjs/common';
import Provider, {
    errors,
    interactionPolicy,
    type Adapter,
    type Configuration,
} from 'oidc-provider';
import type { ClientConfig, Environment } from '../../shared/config/environment';
import type { Account, AccountService } from '../accounts/account.service';

export const TTL = {
    AuthorizationCode: 60,
    AccessToken: 600,
    IdToken: 600,
    Interaction: 600,
    Session: 604800,
    Grant: 1209600,
    RefreshToken: 1209600,
} as const;

export type ProviderSettings = Pick<
    Environment,
    'AUTH_ISSUER' | 'AUTH_JWKS' | 'AUTH_COOKIE_KEYS' | 'AUTH_CLIENTS' | 'AUTH_TRUST_PROXY'
>;

/** Conta carregada uma única vez por requisição, com as claims que irão para os tokens. */
interface ProviderAccount {
    accountId: string;
    profile: Account['claims'];
    claims(): Promise<{ sub: string; [name: string]: unknown }>;
    [name: string]: unknown;
}

export function createProvider(
    env: ProviderSettings,
    adapter: (model: string) => Adapter,
    accounts: AccountService,
): Provider {
    const clients = new Map<string, ClientConfig>(
        env.AUTH_CLIENTS.map(client => [client.clientId, client]),
    );
    const clientConfig = (clientId: string): ClientConfig => {
        const config = clients.get(clientId);
        if (!config) throw new errors.InvalidClient('unknown client');
        return config;
    };

    // Todos os clients são produtos próprios: não existe tela de consentimento.
    const policy = interactionPolicy.base();
    policy.remove('consent');

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
        jwks: env.AUTH_JWKS as Configuration['jwks'],
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
        ttl: TTL,
        expiresWithSession: () => true,
        issueRefreshToken: (_ctx, client) => client.grantTypeAllowed('refresh_token'),
        interactions: {
            policy,
            url: (_ctx, interaction) => '/interaction/' + interaction.uid,
        },
        features: {
            devInteractions: { enabled: false },
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
        async loadExistingGrant(ctx) {
            const client = ctx.oidc.client!;
            const session = ctx.oidc.session!;
            const grantId = session.grantIdFor(client.clientId);
            const existing = grantId ? await ctx.oidc.provider.Grant.find(grantId) : undefined;
            if (existing) return existing;

            const config = clientConfig(client.clientId);
            const grant = new ctx.oidc.provider.Grant({
                accountId: session.accountId,
                clientId: client.clientId,
            });
            grant.addOIDCScope('openid email profile offline_access');
            grant.addResourceScope(config.resource, config.scope);
            await grant.save();
            return grant;
        },
        async findAccount(ctx, sub, token) {
            const clientId = ctx.oidc.client?.clientId;
            // Sem token (autorização), vale o momento do login da sessão: credenciais
            // revogadas depois dele exigem novo login.
            const authTime =
                (token as { authTime?: number } | undefined)?.authTime ?? ctx.oidc.session?.loginTs;
            const account = await accounts.load(sub, {
                firebaseClaims: clientId ? clientConfig(clientId).firebaseClaims : [],
                authTime,
            });
            if (!account) return undefined;
            const result: ProviderAccount = {
                accountId: account.sub,
                profile: account.claims,
                claims: async () => ({ ...account.claims, sub: account.sub }),
            };
            return result;
        },
        // Roda depois de o refresh token ser consumido: nunca consultar serviços externos aqui.
        extraTokenClaims(ctx) {
            const account = ctx.oidc.entities.Account as unknown as ProviderAccount | undefined;
            if (!account) return undefined;
            // `sub` é definido pelo próprio provedor.
            return Object.fromEntries(
                Object.entries(account.profile).filter(([name]) => name !== 'sub'),
            ) as Record<string, string>;
        },
        renderError(ctx, out) {
            ctx.status = 303;
            ctx.set('location', '/error?error=' + encodeURIComponent(out.error));
            ctx.body = '';
            ctx.type = 'text/plain';
        },
    };

    const provider = new Provider(env.AUTH_ISSUER, configuration);
    provider.proxy = env.AUTH_TRUST_PROXY;
    // Só o tipo do erro: mensagens do protocolo podem carregar valores sensíveis.
    provider.on('server_error', (_ctx, error) =>
        Logger.error('Falha no provedor OIDC: ' + error.name, 'OidcProvider'),
    );
    return provider;
}
