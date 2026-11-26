import { z } from 'zod';

const isLoopback = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

const issuerSchema = z.url().superRefine((value, ctx) => {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        ctx.addIssue({
            code: 'custom',
            message:
                'AUTH_ISSUER deve ser uma origem sem credenciais, caminho, query ou fragmento.',
        });
    }
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopback(url))) {
        ctx.addIssue({
            code: 'custom',
            message: 'AUTH_ISSUER exige HTTPS; HTTP é permitido apenas no loopback local.',
        });
    }
});

const redirectSchema = z.url().refine(value => {
    const url = new URL(value);
    const secure = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url));
    return secure && !url.username && !url.password && !value.includes('#');
}, 'Redirect exige HTTPS (HTTP apenas em loopback), sem credenciais ou fragmento.');

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

const emulatorHost = z
    .string()
    .regex(/^[a-zA-Z0-9.-]+:\d{1,5}$/, 'Use host:porta, sem esquema ou caminho.')
    .optional();

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

const environmentSchema = z
    .object({
        NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
        HOST: z.string().trim().min(1).default('127.0.0.1'),
        PORT: z.coerce.number().int().min(1).max(65535).default(3340),
        AUTH_ISSUER: issuerSchema,
        DATABASE_URL: z
            .url()
            .refine(
                value => ['postgres:', 'postgresql:'].includes(new URL(value).protocol),
                'DATABASE_URL deve usar PostgreSQL.',
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
        FIREBASE_AUTH_EMULATOR_HOST: emulatorHost,
        FIRESTORE_EMULATOR_HOST: emulatorHost,
    })
    .superRefine((env, ctx) => {
        if (env.NODE_ENV !== 'production') return;
        const rules = [
            ['AUTH_ISSUER', env.AUTH_ISSUER.startsWith('https://'), 'Produção exige issuer HTTPS.'],
            [
                'AUTH_TRUST_PROXY',
                env.AUTH_TRUST_PROXY,
                'Produção exige proxy TLS confiável (AUTH_TRUST_PROXY=true).',
            ],
            [
                'FIREBASE_AUTH_EMULATOR_HOST',
                !env.FIREBASE_AUTH_EMULATOR_HOST,
                'Emulador proibido em produção.',
            ],
            [
                'FIRESTORE_EMULATOR_HOST',
                !env.FIRESTORE_EMULATOR_HOST,
                'Emulador proibido em produção.',
            ],
            [
                'FIREBASE_PROJECT_ID',
                !env.FIREBASE_PROJECT_ID.startsWith('demo-'),
                'Projeto demo- proibido em produção.',
            ],
        ] as const;
        for (const [path, valid, message] of rules) {
            if (!valid) ctx.addIssue({ code: 'custom', path: [path], message });
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
