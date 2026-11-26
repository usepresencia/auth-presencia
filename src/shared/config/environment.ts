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

const isLoopback = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

/** Redirects exatos: HTTPS (ou HTTP em loopback), sem credenciais nem fragmento. */
const redirectSchema = z.url().refine(value => {
    const url = new URL(value);
    const secure = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url));
    return secure && !url.username && !url.password && !value.includes('#');
}, 'Redirect exige HTTPS (HTTP apenas em loopback), sem credenciais ou fragmento.');

/** Lê JSON de uma variável sem repetir o conteúdo, que pode ter segredos, no erro. */
function json<T extends z.ZodType>(schema: T) {
    return z
        .string()
        .transform((value, ctx): unknown => {
            try {
                return JSON.parse(value);
            } catch {
                ctx.addIssue({ code: 'custom', message: 'JSON inválido.' });
                return z.NEVER;
            }
        })
        .pipe(schema);
}

const signingKeySchema = z.looseObject({
    kty: z.literal('RSA'),
    kid: z.string().min(1),
    alg: z.literal('RS256'),
    use: z.literal('sig'),
    n: z.string().min(1),
    e: z.string().min(1),
    d: z.string().min(1),
});

const clientSchema = z.strictObject({
    clientId: z.string().min(1),
    clientSecret: z.string().min(32),
    redirectUris: z.array(redirectSchema).min(1),
    postLogoutRedirectUris: z.array(redirectSchema),
    resource: z.url(),
    audience: z.string().min(1),
    scope: z.string().min(1),
    firebaseClaims: z.array(z.string().min(1)),
});

export type ClientConfig = z.infer<typeof clientSchema>;

export const environmentSchema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        HOST: z.string().trim().min(1).default('127.0.0.1'),
        PORT: z.coerce.number().int().min(1).max(65535).default(3340),
        AUTH_ISSUER: issuerSchema,
        DATABASE_URL: z
            .url()
            .refine(
                value => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
                'DATABASE_URL must use PostgreSQL.',
            ),
        AUTH_JWKS: json(z.object({ keys: z.array(signingKeySchema).min(1) })),
        AUTH_COOKIE_KEYS: z
            .string()
            .transform(value => value.split(','))
            .pipe(z.array(z.string().min(32)).min(1)),
        AUTH_CLIENTS: json(
            z
                .array(clientSchema)
                .min(1)
                .refine(
                    clients => new Set(clients.map(c => c.clientId)).size === clients.length,
                    'clientId duplicado.',
                ),
        ),
        AUTH_TRUST_PROXY: z
            .enum(['true', 'false'])
            .default('false')
            .transform(value => value === 'true'),
        FIREBASE_PROJECT_ID: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
        FIREBASE_API_KEY: z.string().min(1),
        FIREBASE_CLIENT_EMAIL: z.email().optional(),
        FIREBASE_PRIVATE_KEY: z.string().min(1).optional(),
        FIREBASE_AUTH_EMULATOR_HOST: z
            .string()
            .regex(/^[a-zA-Z0-9.-]+:\d{1,5}$/, 'Use host:porta, sem esquema ou caminho.')
            .optional(),
    })
    .superRefine((env, ctx) => {
        if (env.NODE_ENV === 'production' && !env.AUTH_ISSUER.startsWith('https://')) {
            ctx.addIssue({
                code: 'custom',
                path: ['AUTH_ISSUER'],
                message: 'Produção exige issuer HTTPS.',
            });
        }
        // O emulador aceita tokens sem assinatura: nunca em produção.
        if (env.NODE_ENV === 'production' && env.FIREBASE_AUTH_EMULATOR_HOST) {
            ctx.addIssue({
                code: 'custom',
                path: ['FIREBASE_AUTH_EMULATOR_HOST'],
                message: 'Emulador proibido em produção.',
            });
        }
        if (env.NODE_ENV === 'production' && env.FIREBASE_PROJECT_ID.startsWith('demo-')) {
            ctx.addIssue({
                code: 'custom',
                path: ['FIREBASE_PROJECT_ID'],
                message: 'Projeto demo- proibido em produção.',
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
