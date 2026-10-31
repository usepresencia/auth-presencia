import { z } from 'zod';

const issuerSchema = z.url().superRefine((value, ctx) => {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        ctx.addIssue({
            code: 'custom',
            message:
                'AUTH_ISSUER deve ser uma origem sem credenciais, caminho, query ou fragmento.',
        });
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
        ctx.addIssue({
            code: 'custom',
            message: 'AUTH_ISSUER exige HTTPS; HTTP é permitido apenas no loopback local.',
        });
    }
});

export const environmentSchema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        HOST: z.string().trim().min(1).default('127.0.0.1'),
        PORT: z.coerce.number().int().min(1).max(65535).default(3340),
        AUTH_ISSUER: issuerSchema,
    })
    .superRefine((env, ctx) => {
        if (env.NODE_ENV === 'production' && !env.AUTH_ISSUER.startsWith('https://')) {
            ctx.addIssue({
                code: 'custom',
                path: ['AUTH_ISSUER'],
                message: 'Produção exige issuer HTTPS.',
            });
        }
    });

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(input: Record<string, unknown>): Environment {
    const result = environmentSchema.safeParse(input);
    if (!result.success) {
        const issues = result.error.issues.map(
            issue => `${issue.path.join('.') || 'env'}: ${issue.message}`,
        );
        throw new Error(`Configuração inválida: ${issues.join('; ')}`);
    }
    return result.data;
}
