import type { NextFunction, Request, Response } from 'express';

const HEADERS = {
    'content-security-policy':
        "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
};

export function securityHeaders(issuer: string) {
    const headers: Record<string, string> = issuer.startsWith('https://')
        ? { ...HEADERS, 'strict-transport-security': 'max-age=31536000' }
        : HEADERS;
    return (_request: Request, response: Response, next: NextFunction): void => {
        for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
        next();
    };
}
