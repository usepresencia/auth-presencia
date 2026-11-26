import type { NestExpressApplication } from '@nestjs/platform-express';
import { json } from 'express';
import { OIDC_PROVIDER } from './modules/oidc/oidc.module';
import { oidcMiddleware } from './modules/oidc/provider.middleware';

/**
 * Configuração HTTP compartilhada entre o processo e os testes. A aplicação precisa ser
 * criada com `{ bodyParser: false }`: o provedor OIDC lê o corpo das próprias rotas.
 */
export function configureApp(app: NestExpressApplication): void {
    app.disable('x-powered-by');
    app.enableShutdownHooks();
    app.use('/interaction', json({ limit: '4kb' }));
    app.use(oidcMiddleware(app.get(OIDC_PROVIDER)));
}
