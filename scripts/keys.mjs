import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';

export function newSigningKey() {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    return { ...privateKey.export({ format: 'jwk' }), kid: randomUUID(), alg: 'RS256', use: 'sig' };
}

export const newSecret = () => randomBytes(32).toString('base64url');
