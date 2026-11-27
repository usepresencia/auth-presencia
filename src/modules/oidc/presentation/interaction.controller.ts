import {
    Controller,
    Get,
    HttpCode,
    Inject,
    Param,
    Post,
    Req,
    Res,
    UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import Provider, { errors, type InteractionResults } from 'oidc-provider';
import { z } from 'zod';
import { AppError } from '../../errors/model/app.error';
import { LoginService } from '../application/login.service';
import { SignInError } from '../../accounts/model/sign-in.error';
import { OIDC_PROVIDER } from '../oidc.tokens';
import { loginSchema, passwordResetSchema } from './interaction.schemas';
import { OriginGuard } from './origin.guard';

function parseBody<T>(schema: z.ZodType<T>, request: Request): T {
    const result = request.is('application/json') ? schema.safeParse(request.body) : undefined;
    if (!result?.success) throw new AppError('INVALID_REQUEST');
    return result.data;
}

const addressOf = (request: Request) => request.ip ?? 'unknown';

async function guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof SignInError) throw new AppError(error.code);
        if (error instanceof errors.SessionNotFound) throw new AppError('INTERACTION_EXPIRED');
        throw new AppError('AUTH_UNAVAILABLE', { cause: error });
    }
}

@Controller('interaction/:uid')
@UseGuards(OriginGuard)
export class InteractionController {
    constructor(
        @Inject(OIDC_PROVIDER) private readonly provider: Provider,
        @Inject(LoginService) private readonly logins: LoginService,
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
            const accountId = await this.logins.signIn(
                uid,
                body.email,
                body.password,
                addressOf(request),
            );
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
            const body = parseBody(passwordResetSchema, request);
            await this.pending(uid, request, response);
            await this.logins.sendPasswordReset(body.email, addressOf(request));
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

    private async pending(uid: string, request: Request, response: Response) {
        const interaction = await this.provider.interactionDetails(request, response);
        if (interaction.uid !== uid || interaction.prompt.name !== 'login') {
            throw new AppError('INTERACTION_EXPIRED');
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
