import { randomUUID } from 'node:crypto';
import type { OnModuleDestroy } from '@nestjs/common';
import { applicationDefault, cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import type { Environment } from '../../shared/config/environment';
import type { VerifiedFirebaseIdentity } from '../identity/domain/identity';
import {
    SignInError,
    type FirebaseGateway,
    type FirebaseUser,
    type SignInFailure,
} from './firebase.gateway';

export type FirebaseSettings = Pick<
    Environment,
    | 'FIREBASE_PROJECT_ID'
    | 'FIREBASE_CLIENT_EMAIL'
    | 'FIREBASE_PRIVATE_KEY'
    | 'FIREBASE_AUTH_EMULATOR_HOST'
> &
    Partial<Pick<Environment, 'FIREBASE_API_KEY'>>;

/** Pontos de substituição para testes. */
export interface FirebaseOverrides {
    fetch?: typeof fetch;
    verifyIdToken?: (
        idToken: string,
        checkRevoked: boolean,
    ) => Promise<{ uid: string; email?: string; email_verified?: boolean }>;
}

const TOOLKIT_TIMEOUT_MS = 10_000;

const SIGN_IN_FAILURES: Record<string, SignInFailure> = {
    INVALID_LOGIN_CREDENTIALS: 'INVALID_CREDENTIALS',
    EMAIL_NOT_FOUND: 'INVALID_CREDENTIALS',
    INVALID_PASSWORD: 'INVALID_CREDENTIALS',
    INVALID_EMAIL: 'INVALID_CREDENTIALS',
    USER_DISABLED: 'ACCOUNT_DISABLED',
    TOO_MANY_ATTEMPTS_TRY_LATER: 'TOO_MANY_ATTEMPTS',
};

interface ToolkitResponse {
    idToken?: string;
    mfaPendingCredential?: string;
    error?: { message?: string };
}

/** O Toolkit devolve o código seguido, às vezes, de " : detalhe". */
function errorCode(body: ToolkitResponse): string {
    return body.error?.message?.split(' ')[0] ?? '';
}

export class FirebaseAdminGateway implements FirebaseGateway, OnModuleDestroy {
    private readonly app: App;
    private readonly auth: Auth;
    private readonly projectId: string;
    private readonly apiKey: string;
    private readonly toolkitUrl: string;

    constructor(
        settings: FirebaseSettings,
        private readonly overrides: FirebaseOverrides = {},
    ) {
        const projectId = settings.FIREBASE_PROJECT_ID;
        this.projectId = projectId;
        this.apiKey = settings.FIREBASE_API_KEY ?? '';
        // O Admin SDK lê o host do emulador do ambiente; com ele, não há credencial.
        const emulator =
            settings.FIREBASE_AUTH_EMULATOR_HOST ?? process.env.FIREBASE_AUTH_EMULATOR_HOST;
        this.toolkitUrl = emulator
            ? `http://${emulator}/identitytoolkit.googleapis.com/v1`
            : 'https://identitytoolkit.googleapis.com/v1';
        const clientEmail = settings.FIREBASE_CLIENT_EMAIL;
        const privateKey = settings.FIREBASE_PRIVATE_KEY?.replaceAll('\\n', '\n');
        const credential = emulator
            ? undefined
            : clientEmail && privateKey
              ? cert({ projectId, clientEmail, privateKey })
              : applicationDefault();
        this.app = initializeApp(
            { projectId, ...(credential ? { credential } : {}) },
            'auth-presencia-' + randomUUID(),
        );
        this.auth = getAuth(this.app);
    }

    async getUser(uid: string): Promise<FirebaseUser | null> {
        try {
            const user = await this.auth.getUser(uid);
            return {
                uid: user.uid,
                email: user.email,
                emailVerified: user.emailVerified,
                name: user.displayName,
                disabled: user.disabled,
                validSince: user.tokensValidAfterTime
                    ? Math.floor(Date.parse(user.tokensValidAfterTime) / 1000)
                    : 0,
                customClaims: user.customClaims ?? {},
            };
        } catch (error) {
            if ((error as { code?: string }).code === 'auth/user-not-found') return null;
            throw error;
        }
    }

    async signIn(email: string, password: string): Promise<VerifiedFirebaseIdentity> {
        const body = await this.toolkit('accounts:signInWithPassword', {
            email,
            password,
            returnSecureToken: true,
        });
        if (body.mfaPendingCredential) throw new SignInError('MFA_UNSUPPORTED');
        if (!body.idToken) throw this.failure(body);
        try {
            const verify =
                this.overrides.verifyIdToken ??
                ((token: string, checkRevoked: boolean) =>
                    this.auth.verifyIdToken(token, checkRevoked));
            const decoded = await verify(body.idToken, true);
            return {
                projectId: this.projectId,
                uid: decoded.uid,
                ...(decoded.email ? { email: decoded.email } : {}),
                emailVerified: decoded.email_verified === true,
            };
        } catch (error) {
            if ((error as { code?: string }).code === 'auth/user-disabled') {
                throw new SignInError('ACCOUNT_DISABLED');
            }
            throw error;
        }
    }

    async sendPasswordReset(email: string): Promise<void> {
        const body = await this.toolkit('accounts:sendOobCode', {
            requestType: 'PASSWORD_RESET',
            email,
        });
        if (!body.error) return;
        const code = errorCode(body);
        // Conta inexistente ou desativada responde como sucesso, para não ser revelada.
        if (code === 'EMAIL_NOT_FOUND' || code === 'USER_DISABLED') return;
        throw this.failure(body);
    }

    /** Chama o Identity Toolkit. Erros nunca carregam URL, chave ou corpo da requisição. */
    private async toolkit(operation: string, payload: object): Promise<ToolkitResponse> {
        const request = this.overrides.fetch ?? fetch;
        try {
            const response = await request(
                `${this.toolkitUrl}/${operation}?key=${encodeURIComponent(this.apiKey)}`,
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(payload),
                    signal: AbortSignal.timeout(TOOLKIT_TIMEOUT_MS),
                },
            );
            const body = (await response.json()) as ToolkitResponse;
            if (!response.ok && !body.error) throw new Error('unexpected status');
            return body;
        } catch {
            throw new Error('Firebase Identity Toolkit unavailable.');
        }
    }

    private failure(body: ToolkitResponse): Error {
        const code = SIGN_IN_FAILURES[errorCode(body)];
        return code ? new SignInError(code) : new Error('Firebase Identity Toolkit rejected.');
    }

    async onModuleDestroy(): Promise<void> {
        await deleteApp(this.app);
    }
}
