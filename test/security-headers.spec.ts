import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { securityHeaders } from '../src/modules/protection/presentation/security-headers.middleware';

function headersFor(issuer: string) {
    const headers: Record<string, string> = {};
    const response = {
        setHeader: (name: string, value: string) => (headers[name] = value),
    } as unknown as Response;
    securityHeaders(issuer)({} as Request, response, () => undefined);
    return headers;
}

describe('security headers', () => {
    it('forbids sniffing, framing, referrers and any content', () => {
        expect(headersFor('https://auth.presencia.com.br')).toMatchObject({
            'x-content-type-options': 'nosniff',
            'x-frame-options': 'DENY',
            'referrer-policy': 'no-referrer',
            'content-security-policy':
                "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        });
    });

    it('requires HTTPS only when the issuer uses it', () => {
        expect(headersFor('https://auth.presencia.com.br')['strict-transport-security']).toBe(
            'max-age=31536000',
        );
        expect(headersFor('http://localhost:3340')['strict-transport-security']).toBeUndefined();
    });
});
