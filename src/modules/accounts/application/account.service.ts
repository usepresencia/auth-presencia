import type { Account, LoadOptions } from '../model/account';
import type { IdentityService } from '../../identity/application/identity.service';
import { IdentityDisabledError } from '../../identity/model/identity.errors';
import { SignInError } from '../model/sign-in.error';
import { type FirebaseGateway } from '../model/firebase.gateway';

export class AccountService {
    constructor(
        private readonly identities: Pick<
            IdentityService,
            'findActiveById' | 'resolveVerifiedFirebaseIdentity'
        >,
        private readonly firebase: FirebaseGateway,
        private readonly projectId: string,
    ) {}

    async signIn(email: string, password: string): Promise<string> {
        const principal = await this.firebase.signIn(email, password);
        try {
            return (await this.identities.resolveVerifiedFirebaseIdentity(principal)).id;
        } catch (error) {
            if (error instanceof IdentityDisabledError) {
                throw new SignInError('ACCOUNT_DISABLED');
            }
            throw error;
        }
    }

    async sendPasswordReset(email: string): Promise<void> {
        await this.firebase.sendPasswordReset(email);
    }

    /** @returns o `sub` da pessoa, já autenticada com a nova senha. */
    async definePassword(code: string, password: string): Promise<string> {
        const email = await this.firebase.definePassword(code, password);
        return this.signIn(email, password);
    }

    /**
     * Monta a conta usada nos tokens a partir da identidade e do Firebase.
     *
     * @returns `null` se a identidade ou o usuário não existir, estiver desativado, pertencer a
     * outro projeto ou tiver credenciais revogadas depois de `authTime`.
     */
    async load(sub: string, options: LoadOptions): Promise<Account | null> {
        const identity = await this.identities.findActiveById(sub);
        if (!identity || identity.projectId !== this.projectId) return null;
        const user = await this.firebase.getUser(identity.uid);
        if (!user || user.disabled) return null;
        if (options.authTime !== undefined && user.validSince > options.authTime) return null;

        const custom = options.firebaseClaims.flatMap((name): [string, unknown][] =>
            Object.hasOwn(user.customClaims, name) ? [[name, user.customClaims[name]]] : [],
        );
        const standard = {
            sub: identity.id,
            firebase_uid: identity.uid,
            firebase_project: identity.projectId,
            email: user.email,
            email_verified: user.emailVerified,
            name: user.name,
        };
        const claims = Object.fromEntries(
            [...custom, ...Object.entries(standard)].filter(([, value]) => value !== undefined),
        );
        return { sub: identity.id, claims };
    }
}
