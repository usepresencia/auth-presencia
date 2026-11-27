import { pathToFileURL } from 'node:url';
import { newSecret, newSigningKey } from './keys.mjs';

const STEPS = {
    add: (keys, create) => [...keys, create()],
    promote: keys => [keys.at(-1), ...keys.slice(0, -1)],
    retire: keys => keys.slice(0, 1),
    replace: (_keys, create) => [create()],
};

function parse(value) {
    try {
        return JSON.parse(value);
    } catch {
        return undefined;
    }
}

function currentKeys(env) {
    const keys = parse(env.AUTH_JWKS)?.keys;
    if (Array.isArray(keys) && keys.length > 0) return keys;
    throw new Error('AUTH_JWKS ausente ou inválido.');
}

/**
 * Calcula as variáveis de um passo da rotação. A primeira chave de cada lista é a que assina.
 *
 * @param {'add' | 'promote' | 'retire' | 'replace'} step
 * @param {{ AUTH_JWKS?: string, AUTH_COOKIE_KEYS?: string }} env
 * @returns {{ AUTH_JWKS: string, AUTH_COOKIE_KEYS: string }}
 */
export function rotate(step, env) {
    if (!Object.hasOwn(STEPS, step)) {
        throw new Error('Informe o passo: add, promote, retire ou replace.');
    }
    const cookies = env.AUTH_COOKIE_KEYS?.split(',').filter(Boolean) ?? [];
    if (cookies.length === 0) throw new Error('AUTH_COOKIE_KEYS ausente.');
    return {
        AUTH_JWKS: JSON.stringify({ keys: STEPS[step](currentKeys(env), newSigningKey) }),
        AUTH_COOKIE_KEYS: STEPS[step](cookies, newSecret).join(','),
    };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const next = rotate(process.argv[2], process.env);
    console.log("AUTH_JWKS='" + next.AUTH_JWKS + "'");
    console.log('AUTH_COOKIE_KEYS=' + next.AUTH_COOKIE_KEYS);
}
