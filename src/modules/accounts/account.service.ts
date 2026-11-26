import type { IdentityService } from '../identity/application/identity.service';
import { IdentityDisabledError } from '../identity/domain/identity';
import { SignInError, type FirebaseGateway } from './firebase.gateway';

export interface Account {
    sub: string;
    claims: Record<string, unknown>;
}

export interface LoadOptions {
    /** Claims customizadas do Firebase que o client pode receber. */
    firebaseClaims: string[];
    /** Momento do login (epoch em segundos); revogação posterior invalida a conta. */
    authTime?: number;
}

/** Monta a conta usada nos tokens. Não decide acesso a produto. */
export class AccountService {
    constructor(
        private readonly identities: Pick<
            IdentityService,
            'findActiveById' | 'resolveVerifiedFirebaseIdentity'
        >,
        private readonly firebase: FirebaseGateway,
        private readonly projectId: string,
    ) {}

    /** Autentica por e-mail e senha e devolve o `sub` estável. */
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

    async load(sub: string, options: LoadOptions): Promise<Account | null> {
        const identity = await this.identities.findActiveById(sub);
        if (!identity || identity.projectId !== this.projectId) return null;
        const user = await this.firebase.getUser(identity.uid);
        if (!user || user.disabled) return null;
        if (options.authTime !== undefined && user.validSince > options.authTime) return null;

        const custom = options.firebaseClaims.flatMap(name =>
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
        // As claims padrão vêm por último: claim customizada nunca as substitui.
        const claims = Object.fromEntries(
            [...custom, ...Object.entries(standard)].filter(([, value]) => value !== undefined),
        );
        return { sub: identity.id, claims };
    }
}
