import { Controller, Get, Header, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type Provider from 'oidc-provider';
import { AppError } from '../../errors/model/app.error';
import { OIDC_PROVIDER } from '../oidc.tokens';

interface LogoutSession {
    state?: { secret?: string; clientId?: string };
}

@Controller('session')
export class LogoutController {
    constructor(@Inject(OIDC_PROVIDER) private readonly provider: Provider) {}

    @Get('logout-details')
    @Header('cache-control', 'no-store')
    async details(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
        const context = this.provider.createContext(request, response);
        const session = (await this.provider.Session.get(context)) as LogoutSession;
        if (!session.state?.secret) {
            throw new AppError('LOGOUT_EXPIRED');
        }
        return {
            clientId: session.state.clientId,
            action: '/session/end/confirm',
            xsrf: session.state.secret,
        };
    }
}
