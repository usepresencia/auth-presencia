import { createHash } from 'node:crypto';
import type { AccountService } from '../../accounts/application/account.service';

export class LoginService {
    private readonly signingIn = new Map<string, Promise<string>>();

    constructor(private readonly accounts: Pick<AccountService, 'signIn' | 'sendPasswordReset'>) {}

    /**
     * Autentica compartilhando uma única tentativa entre envios idênticos e simultâneos da
     * mesma interação, nesta instância.
     *
     * @returns o `sub` da pessoa autenticada.
     */
    signIn(interactionUid: string, email: string, password: string): Promise<string> {
        const key = createHash('sha256')
            .update(JSON.stringify([interactionUid, email, password]))
            .digest('base64url');
        let attempt = this.signingIn.get(key);
        if (!attempt) {
            attempt = this.accounts
                .signIn(email, password)
                .finally(() => this.signingIn.delete(key));
            this.signingIn.set(key, attempt);
        }
        return attempt;
    }

    sendPasswordReset(email: string): Promise<void> {
        return this.accounts.sendPasswordReset(email);
    }
}
