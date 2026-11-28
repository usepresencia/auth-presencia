import { Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type Provider from 'oidc-provider';
import { LoginService } from '../application/login.service';
import { OIDC_PROVIDER } from '../oidc.tokens';
import { openBrowserSession } from './browser-session';
import { passwordDefinitionSchema } from './interaction.schemas';
import { OriginGuard } from './origin.guard';
import { guarded, parseBody, requestOrigin } from './request';

@Controller('password')
@UseGuards(OriginGuard)
export class PasswordController {
    constructor(
        @Inject(OIDC_PROVIDER) private readonly provider: Provider,
        @Inject(LoginService) private readonly logins: LoginService,
    ) {}

    @Post('define')
    @HttpCode(204)
    define(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
        return guarded(async () => {
            const body = parseBody(passwordDefinitionSchema, request);
            const accountId = await this.logins.definePassword(
                body.code,
                body.password,
                requestOrigin(request),
            );
            await openBrowserSession(this.provider, request, response, accountId);
        });
    }
}
