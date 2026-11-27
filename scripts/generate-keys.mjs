// Imprime chaves novas para AUTH_JWKS e AUTH_COOKIE_KEYS. Não grava arquivos.
import { newSecret, newSigningKey } from './keys.mjs';

console.log("AUTH_JWKS='" + JSON.stringify({ keys: [newSigningKey()] }) + "'");
console.log('AUTH_COOKIE_KEYS=' + newSecret());
console.log('# Segredo de client (AUTH_CLIENTS): ' + newSecret());
