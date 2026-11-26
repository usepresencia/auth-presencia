import { Logger } from '@nestjs/common';
import Provider, {
    errors,
    interactionPolicy,
    type Adapter,
    type Configuration,
} from 'oidc-provider';
import type { ClientConfig, Environment } from '../../shared/config/environment';
import type { Account, AccountService } from '../accounts/account.service';
import { absoluteRemaining, epochSeconds, sessionTtl, TTL } from './session-policy';

export type ProviderSettings = Pick<
    Environment,
    'AUTH_ISSUER' | 'AUTH_JWKS' | 'AUTH_COOKIE_KEYS' | 'AUTH_CLIENTS' | 'AUTH_TRUST_PROXY'
>;

const GRANT_TOLERANCE_SECONDS = 5;

interface FrontRedirect {
    status: number;
    body: unknown;
    type: string;
    set(name: string, value: string): void;
}

/** Entrega o navegador ao front sem corpo. */
function redirectToFront(ctx: FrontRedirect, location: string): void {
    ctx.status = 303;
    ctx.set('location', location);
    ctx.body = '';
    ctx.type = 'text/plain';
}

interface OidcRequest {
    route: string;
    params?: Record<string, unknown>;
    entities: { RefreshToken?: { sessionUid?: string } };
}

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
    extendSession: (uid: string) => Promise<void>,
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
    // Sessão cuja conta foi desativada ou teve credenciais revogadas exige novo login.
    policy
        .get('login')!
        .checks.add(
            new interactionPolicy.Check(
                'account_unavailable',
                'End-User authentication is required',
                ctx =>
                    ctx.oidc.session?.accountId && !ctx.oidc.account
                        ? interactionPolicy.Check.REQUEST_PROMPT
                        : interactionPolicy.Check.NO_NEED_TO_PROMPT,
            ),
        );

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
        ttl: {
            AuthorizationCode: TTL.AuthorizationCode,
            AccessToken: TTL.AccessToken,
            IdToken: TTL.IdToken,
            Interaction: TTL.Interaction,
            // O provedor exige inteiros positivos; no limite, o artefato dura um segundo.
            Session: (_ctx, session) => {
                const now = epochSeconds();
                return Math.max(1, sessionTtl(session.loginTs ?? now, now));
            },
            Grant: ctx => {
                const now = epochSeconds();
                return Math.max(1, absoluteRemaining(ctx?.oidc.session?.loginTs ?? now, now));
            },
            RefreshToken: (_ctx, token) => {
                const now = epochSeconds();
                const authTime = (token as { authTime?: number }).authTime ?? now;
                return Math.max(1, absoluteRemaining(authTime, now));
            },
        },
        expiresWithSession: () => true,
        rotateRefreshToken: () => true,
        issueRefreshToken: (_ctx, client) => client.grantTypeAllowed('refresh_token'),
        interactions: {
            policy,
            url: (_ctx, interaction) => '/interaction/' + interaction.uid,
        },
        features: {
            devInteractions: { enabled: false },
            revocation: { enabled: true },
            // Nenhuma tela é renderizada aqui: o front cuida da confirmação e do sucesso.
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
        async loadExistingGrant(ctx) {
            const client = ctx.oidc.client!;
            const session = ctx.oidc.session!;
            const grantId = session.grantIdFor(client.clientId);
            const existing = grantId ? await ctx.oidc.provider.Grant.find(grantId) : undefined;
            // Uma concessão de login anterior venceria antes da sessão nova: substituí-la.
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
            redirectToFront(ctx, '/error?error=' + encodeURIComponent(out.error));
        },
    };

    const provider = new Provider(env.AUTH_ISSUER, configuration);
    provider.proxy = env.AUTH_TRUST_PROXY;
    provider.use(async (ctx, next) => {
        await next();
        const oidc = (ctx as unknown as { oidc?: OidcRequest }).oidc;
        // Sem sessão o provedor responderia um formulário HTML: o front confirma igualmente.
        if (oidc?.route === 'end_session' && ctx.status === 200) {
            redirectToFront(ctx, '/logout');
        }
        if (oidc?.route === 'token' && ctx.status === 200) {
            const sessionUid = oidc.entities.RefreshToken?.sessionUid;
            if (oidc.params?.['grant_type'] === 'refresh_token' && sessionUid) {
                await extendSession(sessionUid);
            }
        }
    });
    // Só o tipo do erro: mensagens do protocolo podem carregar valores sensíveis.
    provider.on('server_error', (_ctx, error) =>
        Logger.error('Falha no provedor OIDC: ' + error.name, 'OidcProvider'),
    );
    return provider;
}
