import { interactionPolicy } from 'oidc-provider';

/**
 * Política sem tela de consentimento, que exige novo login quando a conta da sessão deixa de
 * estar disponível.
 */
export function loginPolicy() {
    const policy = interactionPolicy.base();
    policy.remove('consent');
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
    return policy;
}
