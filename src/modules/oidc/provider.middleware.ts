import type { NextFunction, Request, Response } from 'express';
import type Provider from 'oidc-provider';

/** Únicos caminhos entregues ao provedor; o restante segue para as rotas do Nest. */
const PROVIDER_PATHS = [
    '/.well-known/openid-configuration',
    '/jwks',
    '/authorize',
    '/token',
    '/me',
    '/session',
];

/** Rotas do Nest sob prefixos do provedor. */
const NEST_PATHS = ['/session/logout-details'];

const matches = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/');

export function oidcMiddleware(provider: Provider) {
    const handle = provider.callback();
    return (request: Request, response: Response, next: NextFunction): void => {
        const url = new URL(request.url, 'http://placeholder');
        const path = url.pathname.toLowerCase();
        if (!PROVIDER_PATHS.some(prefix => matches(path, prefix))) return next();
        if (NEST_PATHS.some(prefix => matches(path, prefix))) return next();

        // `form_post` devolveria HTML e `fragment` exporia o code ao navegador. Só GET com
        // `query` chega ao início da autorização.
        if (path === '/authorize' || path === '/authorize/') {
            if (request.method !== 'GET' && request.method !== 'HEAD') {
                response.setHeader('allow', 'GET, HEAD');
                response.status(405).json({ error: 'invalid_request' });
                return;
            }
        }
        if (url.searchParams.getAll('response_mode').some(mode => mode !== 'query')) {
            response.status(400).json({ error: 'invalid_request' });
            return;
        }
        void handle(request, response);
    };
}
