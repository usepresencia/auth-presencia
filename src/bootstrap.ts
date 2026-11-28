import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, type NextFunction, type Request, type Response } from 'express';
import { correlationIdMiddleware } from './modules/errors/presentation/correlation-id.middleware';
import { sendError } from './modules/errors/presentation/error-response';
import { RateLimiterService } from './modules/protection/application/rate-limiter.service';
import { securityHeaders } from './modules/protection/presentation/security-headers.middleware';
import { tokenRateLimit } from './modules/protection/presentation/token-rate-limit.middleware';
import type { Environment } from './shared/config/environment';
import { OIDC_PROVIDER } from './modules/oidc/oidc.tokens';
import { oidcMiddleware } from './modules/oidc/presentation/provider.middleware';

export function configureApp(app: NestExpressApplication): void {
    app.disable('x-powered-by');
    app.enableShutdownHooks();
    const config = app.get(ConfigService<Environment, true>);
    if (config.get('AUTH_TRUST_PROXY', { infer: true })) app.set('trust proxy', 1);
    app.use(correlationIdMiddleware);
    app.use(securityHeaders(config.get('AUTH_ISSUER', { infer: true })));
    app.use(tokenRateLimit(app.get(RateLimiterService)));
    app.use(
        ['/interaction', '/password'],
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
