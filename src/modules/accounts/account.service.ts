import type { IdentityService } from '../identity/application/identity.service';
import type { FirebaseGateway } from './firebase.gateway';

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
        private readonly identities: Pick<IdentityService, 'findActiveById'>,
        private readonly firebase: FirebaseGateway,
        private readonly projectId: string,
    ) {}

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
