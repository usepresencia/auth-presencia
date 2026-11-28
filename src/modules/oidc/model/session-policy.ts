const DAY = 86400;

export const TTL = {
    AuthorizationCode: 60,
    AccessToken: 600,
    IdToken: 600,
    Interaction: 600,
    SessionIdle: 7 * DAY,
    SessionAbsolute: 14 * DAY,
} as const;

export const SESSION_COOKIE = { httpOnly: true, sameSite: 'lax' } as const;

export const epochSeconds = () => Math.floor(Date.now() / 1000);

export function absoluteRemaining(loginTs: number, now: number): number {
    return Math.max(0, loginTs + TTL.SessionAbsolute - now);
}

/**
 * Calcula a validade de uma sessão ao ser regravada: a janela ociosa limitada pelo teto
 * absoluto contado do login.
 */
export function sessionTtl(loginTs: number, now: number): number {
    return Math.min(TTL.SessionIdle, absoluteRemaining(loginTs, now));
}
