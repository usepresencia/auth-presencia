import { Controller, Get, Header, HttpException, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type Provider from 'oidc-provider';
import { OIDC_PROVIDER } from './oidc.tokens';

interface LogoutSession {
    state?: { secret?: string; clientId?: string };
}

/** Dados para o front montar a confirmação de logout. */
@Controller('session')
export class LogoutController {
    constructor(@Inject(OIDC_PROVIDER) private readonly provider: Provider) {}

    @Get('logout-details')
    @Header('cache-control', 'no-store')
    async details(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
        // A sessão é lida pelo cookie assinado do próprio navegador.
        const context = this.provider.createContext(request, response);
        const session = (await this.provider.Session.get(context as never)) as LogoutSession;
        if (!session.state?.secret) {
            throw new HttpException({ code: 'LOGOUT_EXPIRED' }, 410);
        }
        return {
            clientId: session.state.clientId,
            action: '/session/end/confirm',
            xsrf: session.state.secret,
        };
    }
}
