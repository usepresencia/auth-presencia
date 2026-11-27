import { createHash } from 'node:crypto';
import type { AuditService } from '../../audit/application/audit.service';
import { AppError } from '../../errors/model/app.error';
import type { AccountService } from '../../accounts/application/account.service';
import { SignInError } from '../../accounts/model/sign-in.error';
import type { RateLimiterService } from '../../protection/application/rate-limiter.service';
import { LIMITS } from '../../protection/model/rate-limit';

export interface LoginOrigin {
    interactionUid: string;
    clientId: string;
    correlationId: string;
    address: string;
}

const context = ({ clientId, correlationId, address }: LoginOrigin) => ({
    clientId,
    correlationId,
    address,
});

export class LoginService {
    private readonly signingIn = new Map<string, Promise<string>>();

    constructor(
        private readonly accounts: Pick<AccountService, 'signIn' | 'sendPasswordReset'>,
        private readonly limiter: RateLimiterService,
        private readonly audit: AuditService,
    ) {}

    /**
     * Autentica compartilhando uma única tentativa entre envios idênticos e simultâneos da
     * mesma interação, nesta instância.
     *
     * @returns o `sub` da pessoa autenticada.
     * @throws AppError `TOO_MANY_ATTEMPTS` quando o limite de tentativas foi excedido.
     */
    signIn(email: string, password: string, origin: LoginOrigin): Promise<string> {
        const key = createHash('sha256')
            .update(JSON.stringify([origin.interactionUid, email, password, origin.address]))
            .digest('base64url');
        let attempt = this.signingIn.get(key);
        if (!attempt) {
            attempt = this.auditedSignIn(email, password, origin).finally(() =>
                this.signingIn.delete(key),
            );
            this.signingIn.set(key, attempt);
        }
        return attempt;
    }

    async sendPasswordReset(email: string, origin: LoginOrigin): Promise<void> {
        await this.limiter.consume([
            { rule: LIMITS.resetByEmail, subject: email },
            { rule: LIMITS.resetByAddress, subject: origin.address },
        ]);
        await this.accounts.sendPasswordReset(email);
        await this.audit.record({ type: 'password_reset_requested', email, ...context(origin) });
    }

    private async auditedSignIn(email: string, password: string, origin: LoginOrigin) {
        try {
            const identityId = await this.limitedSignIn(email, password, origin.address);
            await this.audit.record({
                type: 'login_succeeded',
                identityId,
                email,
                ...context(origin),
            });
            return identityId;
        } catch (error) {
            const reason =
                error instanceof SignInError || error instanceof AppError
                    ? error.code
                    : 'AUTH_UNAVAILABLE';
            await this.audit.record({ type: 'login_failed', reason, email, ...context(origin) });
            throw error;
        }
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
