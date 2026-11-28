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
import Provider, { type InteractionResults } from 'oidc-provider';
import { AppError } from '../../errors/model/app.error';
import { LoginService, type LoginOrigin } from '../application/login.service';
import { OIDC_PROVIDER } from '../oidc.tokens';
import { loginSchema, passwordResetSchema } from './interaction.schemas';
import { OriginGuard } from './origin.guard';
import { guarded, parseBody, requestOrigin } from './request';

const originOf = (
    interaction: { uid: string; params: Record<string, unknown> },
    request: Request,
): LoginOrigin => ({
    ...requestOrigin(request),
    interactionUid: interaction.uid,
    clientId: String(interaction.params['client_id']),
});

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
                body.email,
                body.password,
                originOf(interaction, request),
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
            const interaction = await this.pending(uid, request, response);
            await this.logins.sendPasswordReset(body.email, originOf(interaction, request));
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
