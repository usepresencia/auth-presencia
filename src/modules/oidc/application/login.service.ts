import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { errorName } from '../../../shared/utils/error-name';
import type { AuditService } from '../../audit/application/audit.service';
import { AppError } from '../../errors/model/app.error';
import type { AccountService } from '../../accounts/application/account.service';
import { SignInError } from '../../accounts/model/sign-in.error';
import type { RateLimiterService } from '../../protection/application/rate-limiter.service';
import { LIMITS, type RateLimitUse } from '../../protection/model/rate-limit';

export interface RequestOrigin {
    clientId?: string;
    correlationId: string;
    address: string;
}

export interface LoginOrigin extends RequestOrigin {
    interactionUid: string;
    clientId: string;
}

const context = ({ clientId, correlationId, address }: RequestOrigin) => ({
    ...(clientId ? { clientId } : {}),
    correlationId,
    address,
});

const reasonOf = (error: unknown) =>
    error instanceof SignInError || error instanceof AppError ? error.code : 'AUTH_UNAVAILABLE';

export class LoginService {
    private readonly signingIn = new Map<string, Promise<string>>();

    constructor(
        private readonly accounts: Pick<
            AccountService,
            'signIn' | 'sendPasswordReset' | 'definePassword'
        >,
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

    /**
     * Grava a senha com um código de uso único e autentica a pessoa.
     *
     * @returns o `sub` da pessoa.
     * @throws AppError `TOO_MANY_ATTEMPTS` quando o endereço excedeu o limite de recusas.
     */
    async definePassword(code: string, password: string, origin: RequestOrigin): Promise<string> {
        const uses = [{ rule: LIMITS.passwordByAddress, subject: origin.address }];
        try {
            const identityId = await this.counted(uses, () =>
                this.accounts.definePassword(code, password),
            );
            await this.bestEffort(this.limiter.refund(uses));
            await this.audit.record({ type: 'password_defined', identityId, ...context(origin) });
            return identityId;
        } catch (error) {
            await this.audit.record({
                type: 'password_definition_failed',
                reason: reasonOf(error),
                ...context(origin),
            });
            throw error;
        }
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
            const reason = reasonOf(error);
            await this.audit.record({ type: 'login_failed', reason, email, ...context(origin) });
            throw error;
        }
    }

    private async limitedSignIn(email: string, password: string, address: string) {
        const own = {
            rule: LIMITS.loginByEmailAndAddress,
            subject: JSON.stringify([email, address]),
        };
        const shared = [
            { rule: LIMITS.loginByEmail, subject: email },
            { rule: LIMITS.loginByAddress, subject: address },
        ];
        const accountId = await this.counted([own, ...shared], () =>
            this.accounts.signIn(email, password),
        );
        await this.bestEffort(this.limiter.clear(own));
        await this.bestEffort(this.limiter.refund(shared));
        return accountId;
    }

    /** Conta a tentativa antes de executá-la e a devolve se a falha não for uma recusa. */
    private async counted<T>(uses: RateLimitUse[], attempt: () => Promise<T>): Promise<T> {
        await this.limiter.consume(uses);
        try {
            return await attempt();
        } catch (error) {
            if (!(error instanceof SignInError)) {
                await this.bestEffort(this.limiter.refund(uses));
            }
            throw error;
        }
    }

    private bestEffort(adjustment: Promise<void>): Promise<void> {
        return adjustment.catch((error: unknown) =>
            Logger.warn('Falha ao ajustar o limite: ' + errorName(error), 'LoginService'),
        );
    }
}
