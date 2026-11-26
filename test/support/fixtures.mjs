import { generateKeyPairSync, randomBytes } from 'node:crypto';

export const secret = () => randomBytes(32).toString('base64url');

export const signingKey = kid => ({
    ...generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' }),
    kid,
    alg: 'RS256',
    use: 'sig',
});

export const kontalClient = (redirectUri, postLogoutRedirectUri) => ({
    clientId: 'web-kontal',
    clientSecret: secret(),
    redirectUris: [redirectUri],
    postLogoutRedirectUris: [postLogoutRedirectUri],
    resource: 'urn:presencia:api-kontal',
    audience: 'api-kontal',
    scope: 'api',
    firebaseClaims: ['platformRole', 'kontalMemberships'],
});

export const jwtClaims = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
