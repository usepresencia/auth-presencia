import { z } from 'zod';
import { redirectSchema } from './redirect-uri';

const OIDC_SCOPES = ['openid', 'email', 'profile', 'offline_access'];

const RESERVED_CLAIMS = [
    'acr',
    'amr',
    'aud',
    'auth_time',
    'azp',
    'client_id',
    'cnf',
    'email',
    'email_verified',
    'exp',
    'firebase_project',
    'firebase_uid',
    'iat',
    'iss',
    'jti',
    'name',
    'nbf',
    'nonce',
    'scope',
    'sid',
    'sub',
];

const distinct = (values: string[]) => new Set(values).size === values.length;

const uriList = z.array(redirectSchema).refine(distinct, 'URI repetida.');

const clientSchema = z.strictObject({
    clientId: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{1,63}$/, 'Use letras minúsculas, números e hífen.'),
    clientSecret: z.string().min(32),
    redirectUris: uriList.pipe(z.array(z.string()).min(1)),
    postLogoutRedirectUris: uriList,
    resource: z.url(),
    audience: z.string().min(1),
    scope: z
        .string()
        .refine(
            value => value.split(' ').every(item => item && !OIDC_SCOPES.includes(item)),
            'Use somente escopos da API, separados por um espaço.',
        ),
    firebaseClaims: z.array(
        z
            .string()
            .min(1)
            .refine(claim => !RESERVED_CLAIMS.includes(claim), 'Claim reservada.'),
    ),
});

export type ClientConfig = z.infer<typeof clientSchema>;

export const clientsSchema = z
    .array(clientSchema)
    .min(1)
    .superRefine((clients, ctx) => {
        const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
        const ids = clients.map(client => client.clientId);
        if (!distinct(ids)) issue('clientId duplicado.');
        if (!distinct(clients.map(client => client.clientSecret))) {
            issue('clientSecret repetido entre clients.');
        }
        const pairs = new Set(clients.map(c => JSON.stringify([c.resource, c.audience])));
        const resources = new Set(clients.map(client => client.resource));
        const audiences = new Set(clients.map(client => client.audience));
        if (pairs.size !== resources.size || pairs.size !== audiences.size) {
            issue('Cada resource e audience devem corresponder um ao outro.');
        }
        if (clients.some(client => ids.includes(client.audience))) {
            issue('audience não pode ser igual a um clientId.');
        }
    });
