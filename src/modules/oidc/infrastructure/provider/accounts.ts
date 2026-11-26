import type { Configuration } from 'oidc-provider';
import type { AccountService } from '../../../accounts/application/account.service';
import type { Account } from '../../../accounts/model/account';
import type { ClientRegistry } from './client-registry';

interface ProviderAccount {
    accountId: string;
    profile: Account['claims'];
    claims(): Promise<{ sub: string; [name: string]: unknown }>;
    [name: string]: unknown;
}

function providerAccount(sub: string, profile: Account['claims']): ProviderAccount {
    return { accountId: sub, profile, claims: () => Promise.resolve({ ...profile, sub }) };
}

/**
 * Funções de conta do provedor. Um artefato já consumido recebe uma conta sem claims, sem
 * consulta a serviços externos.
 */
export function accountSupport(
    accounts: AccountService,
    clientConfig: ClientRegistry,
): Pick<Configuration, 'findAccount' | 'extraTokenClaims'> {
    return {
        async findAccount(ctx, sub, token) {
            const clientId = ctx.oidc.client?.clientId;
            const artifact = token as { authTime?: number; consumed?: unknown } | undefined;
            if (artifact?.consumed) return providerAccount(sub, {});
            const account = await accounts.load(sub, {
                firebaseClaims: clientId ? clientConfig(clientId).firebaseClaims : [],
                authTime: artifact?.authTime ?? ctx.oidc.session?.loginTs,
            });
            return account ? providerAccount(account.sub, account.claims) : undefined;
        },
        extraTokenClaims(ctx) {
            const account = ctx.oidc.entities.Account as unknown as ProviderAccount | undefined;
            if (!account) return undefined;
            return Object.fromEntries(
                Object.entries(account.profile).filter(([name]) => name !== 'sub'),
            );
        },
    };
}
