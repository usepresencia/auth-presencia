import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, type NextFunction, type Request, type Response } from 'express';
import { correlationIdMiddleware } from './modules/errors/presentation/correlation-id.middleware';
import { sendError } from './modules/errors/presentation/error-response';
import { OIDC_PROVIDER } from './modules/oidc/oidc.tokens';
import { oidcMiddleware } from './modules/oidc/presentation/provider.middleware';

export function configureApp(app: NestExpressApplication): void {
    app.disable('x-powered-by');
    app.enableShutdownHooks();
    app.use(correlationIdMiddleware);
    app.use(
        '/interaction',
        (_request: Request, response: Response, next: NextFunction) => {
            response.setHeader('cache-control', 'no-store');
            next();
        },
        json({ limit: '4kb' }),
        (_error: unknown, request: Request, response: Response, _next: NextFunction) => {
            sendError(request, response, 'INVALID_REQUEST');
        },
    );
    app.use(oidcMiddleware(app.get(OIDC_PROVIDER)));
}
