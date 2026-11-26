import { Logger } from '@nestjs/common';
import type Provider from 'oidc-provider';
import { CORRELATION_HEADER, resolveCorrelationId } from '../../../errors/model/correlation-id';
import type { ErrorReport } from '../../../errors/model/error-log';
import { errorName } from '../../../../shared/utils/error-name';
import { redirectToFront } from './front-redirect';

interface OidcRequest {
    route: string;
    params?: Record<string, unknown>;
    entities: { RefreshToken?: { sessionUid?: string } };
}

interface FailedRequest {
    method: string;
    path: string;
    get(header: string): string;
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
    reportError: (report: ErrorReport) => void,
): void {
    const reportFailure = (message: string, error: unknown, ctx?: FailedRequest) => {
        logFailure(message)(error);
        if (!ctx) return;
        reportError({
            error,
            correlationId: resolveCorrelationId(ctx.get(CORRELATION_HEADER)),
            status: (error as { statusCode?: number }).statusCode ?? 500,
            method: ctx.method,
            path: ctx.path,
        });
    };
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
    provider.on('server_error', (ctx, error) =>
        reportFailure('Falha no provedor OIDC', error, ctx),
    );
    (provider as unknown as NodeJS.EventEmitter).on(
        'error',
        (error: unknown, ctx?: FailedRequest) =>
            reportFailure('Falha na requisição OIDC', error, ctx),
    );
}
