import { createHash } from 'node:crypto';
import type { AccountService } from '../../accounts/application/account.service';
import { SignInError } from '../../accounts/model/sign-in.error';
import type { RateLimiterService } from '../../protection/application/rate-limiter.service';
import { LIMITS } from '../../protection/model/rate-limit';

export class LoginService {
    private readonly signingIn = new Map<string, Promise<string>>();

    constructor(
        private readonly accounts: Pick<AccountService, 'signIn' | 'sendPasswordReset'>,
        private readonly limiter: RateLimiterService,
    ) {}

    /**
     * Autentica compartilhando uma única tentativa entre envios idênticos e simultâneos da
     * mesma interação, nesta instância.
     *
     * @returns o `sub` da pessoa autenticada.
     * @throws AppError `TOO_MANY_ATTEMPTS` quando o limite de tentativas foi excedido.
     */
    signIn(
        interactionUid: string,
        email: string,
        password: string,
        address: string,
    ): Promise<string> {
        const key = createHash('sha256')
            .update(JSON.stringify([interactionUid, email, password, address]))
            .digest('base64url');
        let attempt = this.signingIn.get(key);
        if (!attempt) {
            attempt = this.limitedSignIn(email, password, address).finally(() =>
                this.signingIn.delete(key),
            );
            this.signingIn.set(key, attempt);
        }
        return attempt;
    }

    async sendPasswordReset(email: string, address: string): Promise<void> {
        await this.limiter.consume([
            { rule: LIMITS.resetByEmail, subject: email },
            { rule: LIMITS.resetByAddress, subject: address },
        ]);
        await this.accounts.sendPasswordReset(email);
    }

    /** Conta a tentativa antes de testar a senha e a devolve se a falha não for uma recusa. */
    private async limitedSignIn(email: string, password: string, address: string) {
        const own = {
            rule: LIMITS.loginByEmailAndAddress,
            subject: JSON.stringify([email, address]),
        };
        const shared = [
            { rule: LIMITS.loginByEmail, subject: email },
            { rule: LIMITS.loginByAddress, subject: address },
        ];
        await this.limiter.consume([own, ...shared]);
        try {
            const accountId = await this.accounts.signIn(email, password);
            await this.limiter.clear(own);
            await this.limiter.refund(shared);
            return accountId;
        } catch (error) {
            if (!(error instanceof SignInError)) await this.limiter.refund([own, ...shared]);
            throw error;
        }
    }
}
