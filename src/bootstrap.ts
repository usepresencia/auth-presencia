import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, type NextFunction, type Request, type Response } from 'express';
import { OIDC_PROVIDER } from './modules/oidc/oidc.module';
import { oidcMiddleware } from './modules/oidc/provider.middleware';

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
        (_error: unknown, _request: Request, response: Response, _next: NextFunction) => {
            response.status(400).json({ code: 'INVALID_REQUEST' });
        },
    );
    app.use(oidcMiddleware(app.get(OIDC_PROVIDER)));
}
