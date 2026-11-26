const DAY = 86400;

/** Tempos de vida em segundos. */
export const TTL = {
    AuthorizationCode: 60,
    AccessToken: 600,
    IdToken: 600,
    Interaction: 600,
    /** Janela de inatividade da sessão. */
    SessionIdle: 7 * DAY,
    /** Teto desde o login; vale para sessão, concessão e refresh token. */
    SessionAbsolute: 14 * DAY,
} as const;

export const epochSeconds = () => Math.floor(Date.now() / 1000);

/** Quanto falta para o teto absoluto contado do login. */
export function absoluteRemaining(loginTs: number, now: number): number {
    return Math.max(0, loginTs + TTL.SessionAbsolute - now);
}

/** Validade de uma sessão ao ser regravada: janela ociosa limitada pelo teto absoluto. */
export function sessionTtl(loginTs: number, now: number): number {
    return Math.min(TTL.SessionIdle, absoluteRemaining(loginTs, now));
}
