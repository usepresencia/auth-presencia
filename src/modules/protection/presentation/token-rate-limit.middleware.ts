import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { errorName } from '../../../shared/utils/error-name';
import type { RateLimiterService } from '../application/rate-limiter.service';
import { LIMITS } from '../model/rate-limit';

const LIMITED_PATHS = /^\/token(\/revocation)?\/?$/i;
const REFUSALS = [400, 401];

/**
 * Bloqueia um endereço que acumula recusas em `/token`, respondendo no formato do OAuth.
 * Requisições bem-sucedidas nunca são contadas.
 */
export function tokenRateLimit(limiter: RateLimiterService) {
    return (request: Request, response: Response, next: NextFunction): void => {
        if (request.method !== 'POST' || !LIMITED_PATHS.test(request.path)) return next();
        const use = { rule: LIMITS.refusedTokenByAddress, subject: request.ip ?? 'unknown' };
        limiter
            .blockedFor(use)
            .then(wait => {
                if (wait > 0) {
                    response.setHeader('retry-after', String(wait));
                    response.status(429).json({ error: 'temporarily_unavailable' });
                    return;
                }
                response.on('finish', () => {
                    if (!REFUSALS.includes(response.statusCode)) return;
                    limiter.consume([use]).catch((error: unknown) => {
                        if (errorName(error) !== 'AppError') {
                            Logger.warn(
                                'Falha ao contar recusa: ' + errorName(error),
                                'TokenRateLimit',
                            );
                        }
                    });
                });
                next();
            })
            .catch(next);
    };
}
