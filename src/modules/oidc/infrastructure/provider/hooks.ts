import { Logger } from '@nestjs/common';
import type Provider from 'oidc-provider';
import { errorName } from '../../../../shared/utils/error-name';
import { redirectToFront } from './front-redirect';

interface OidcRequest {
    route: string;
    params?: Record<string, unknown>;
    entities: { RefreshToken?: { sessionUid?: string } };
}

const logFailure = (message: string) => (error: unknown) =>
    Logger.error(message + ': ' + errorName(error), 'OidcProvider');

/**
 * Ajusta as respostas do provedor: discovery só com `query`, formulários HTML trocados pela
 * confirmação do front e renovação da sessão após um refresh. Registra falhas pelo nome.
 */
export function registerHooks(
    provider: Provider,
    extendSession: (uid: string) => Promise<void>,
): void {
    provider.use(async (ctx, next) => {
        await next();
        const oidc = (ctx as unknown as { oidc?: OidcRequest }).oidc;
        if (oidc?.route === 'discovery') {
            (ctx.body as Record<string, unknown>)['response_modes_supported'] = ['query'];
        }
        const htmlForm =
            (oidc?.route === 'end_session' || oidc?.route === 'resume') && ctx.status === 200;
        if (htmlForm) {
            redirectToFront(ctx, '/logout');
        }
        if (oidc?.route === 'token' && ctx.status === 200) {
            const sessionUid = oidc.entities.RefreshToken?.sessionUid;
            if (oidc.params?.['grant_type'] === 'refresh_token' && sessionUid) {
                await extendSession(sessionUid).catch(logFailure('Falha ao renovar a sessão'));
            }
        }
    });
    provider.on('server_error', (_ctx, error) => logFailure('Falha no provedor OIDC')(error));
    (provider as unknown as NodeJS.EventEmitter).on(
        'error',
        logFailure('Falha na requisição OIDC'),
    );
}
