// Imprime chaves novas para AUTH_JWKS e AUTH_COOKIE_KEYS. Não grava arquivos.
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = {
    ...privateKey.export({ format: 'jwk' }),
    kid: randomUUID(),
    alg: 'RS256',
    use: 'sig',
};

console.log("AUTH_JWKS='" + JSON.stringify({ keys: [key] }) + "'");
console.log('AUTH_COOKIE_KEYS=' + randomBytes(32).toString('base64url'));
console.log('# Segredo de client (AUTH_CLIENTS): ' + randomBytes(32).toString('base64url'));
