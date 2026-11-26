import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, type NextFunction, type Request, type Response } from 'express';
import { OIDC_PROVIDER } from './modules/oidc/oidc.module';
import { oidcMiddleware } from './modules/oidc/provider.middleware';

/**
 * Configuração HTTP compartilhada entre o processo e os testes. A aplicação precisa ser
 * criada com `{ bodyParser: false }`: o provedor OIDC lê o corpo das próprias rotas.
 */
export function configureApp(app: NestExpressApplication): void {
    app.disable('x-powered-by');
    app.enableShutdownHooks();
    app.use(
        '/interaction',
        (_request: Request, response: Response, next: NextFunction) => {
            response.setHeader('cache-control', 'no-store');
            next();
        },
        json({ limit: '4kb' }),
        // Corpo inválido ou grande demais: responder em JSON, sem a página de erro padrão.
        (_error: unknown, _request: Request, response: Response, _next: NextFunction) => {
            response.status(400).json({ code: 'INVALID_REQUEST' });
        },
    );
    app.use(oidcMiddleware(app.get(OIDC_PROVIDER)));
}
