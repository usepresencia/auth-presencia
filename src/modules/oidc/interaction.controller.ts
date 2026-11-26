import { createHash } from 'node:crypto';
import {
    Controller,
    Get,
    HttpCode,
    HttpException,
    Inject,
    Logger,
    Param,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import Provider, { errors, type InteractionResults } from 'oidc-provider';
import { z } from 'zod';
import { AccountService } from '../accounts/account.service';
import { SignInError, type SignInFailure } from '../accounts/firebase.gateway';
import { OIDC_PROVIDER } from './oidc.tokens';
import { OriginGuard } from './origin.guard';

const email = z.email().max(320);
const loginSchema = z.strictObject({ email, password: z.string().min(1).max(1024) });
const resetSchema = z.strictObject({ email });

const FAILURE_STATUS: Record<SignInFailure, number> = {
    INVALID_CREDENTIALS: 401,
    ACCOUNT_DISABLED: 403,
    MFA_UNSUPPORTED: 403,
    TOO_MANY_ATTEMPTS: 429,
};

const fail = (status: number, code: string) => new HttpException({ code }, status);

function parseBody<T>(schema: z.ZodType<T>, request: Request): T {
    const result = request.is('application/json') ? schema.safeParse(request.body) : undefined;
    if (!result?.success) throw fail(400, 'INVALID_REQUEST');
    return result.data;
}

async function guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof HttpException) throw error;
        if (error instanceof SignInError) throw fail(FAILURE_STATUS[error.code], error.code);
        if (error instanceof errors.SessionNotFound) throw fail(410, 'INTERACTION_EXPIRED');
        Logger.error(
            'Falha na interação: ' + (error instanceof Error ? error.name : 'desconhecida'),
            'InteractionController',
        );
        throw fail(503, 'AUTH_UNAVAILABLE');
    }
}

@Controller('interaction/:uid')
@UseGuards(OriginGuard)
export class InteractionController {
    private readonly signingIn = new Map<string, Promise<string>>();

    constructor(
        @Inject(OIDC_PROVIDER) private readonly provider: Provider,
        @Inject(AccountService) private readonly accounts: AccountService,
    ) {}

    @Get('details')
    async details(
        @Param('uid') uid: string,
        @Req() request: Request,
        @Res({ passthrough: true }) response: Response,
    ) {
        const interaction = await guarded(() => this.pending(uid, request, response));
        return {
            uid: interaction.uid,
            clientId: interaction.params['client_id'],
            prompt: interaction.prompt.name,
        };
    }

    @Post('login')
    @HttpCode(200)
    login(
        @Param('uid') uid: string,
        @Req() request: Request,
        @Res({ passthrough: true }) response: Response,
    ) {
        return guarded(async () => {
            const body = parseBody(loginSchema, request);
            const interaction = await this.pending(uid, request, response);
            if (interaction.result?.login) return { redirectTo: interaction.returnTo };
            const accountId = await this.signInOnce(uid, body.email, body.password);
            return this.finish(request, response, { login: { accountId, remember: true } });
        });
    }

    @Post('password-reset')
    @HttpCode(204)
    passwordReset(
        @Param('uid') uid: string,
        @Req() request: Request,
        @Res({ passthrough: true }) response: Response,
    ): Promise<void> {
        return guarded(async () => {
            const body = parseBody(resetSchema, request);
            await this.pending(uid, request, response);
            await this.accounts.sendPasswordReset(body.email);
        });
    }

    @Post('abort')
    @HttpCode(200)
    abort(
        @Param('uid') uid: string,
        @Req() request: Request,
        @Res({ passthrough: true }) response: Response,
    ) {
        return guarded(async () => {
            await this.pending(uid, request, response);
            return this.finish(request, response, { error: 'access_denied' });
        });
    }

    /**
     * Autentica compartilhando uma única tentativa entre envios idênticos e simultâneos da
     * mesma interação, nesta instância.
     */
    private signInOnce(uid: string, email: string, password: string): Promise<string> {
        const key = createHash('sha256')
            .update(JSON.stringify([uid, email, password]))
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

    private async pending(uid: string, request: Request, response: Response) {
        const interaction = await this.provider.interactionDetails(request, response);
        if (interaction.uid !== uid || interaction.prompt.name !== 'login') {
            throw fail(410, 'INTERACTION_EXPIRED');
        }
        return interaction;
    }

    private async finish(request: Request, response: Response, result: InteractionResults) {
        const redirectTo = await this.provider.interactionResult(request, response, result, {
            mergeWithLastSubmission: false,
        });
        return { redirectTo };
    }
}
