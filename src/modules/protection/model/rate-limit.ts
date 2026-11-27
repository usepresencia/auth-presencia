export interface RateLimitRule {
    name: string;
    limit: number;
    windowSeconds: number;
}

export interface RateLimitUse {
    rule: RateLimitRule;
    subject: string;
}

export interface RateLimitState {
    count: number;
    windowStart: Date;
    blockedUntil: Date | null;
    strikes: number;
    updatedAt: Date;
}

export interface RateLimitStore {
    update<T>(
        key: string,
        change: (state: RateLimitState | undefined) => { state: RateLimitState; result: T },
    ): Promise<T>;
    find(key: string): Promise<RateLimitState | undefined>;
    delete(key: string): Promise<void>;
}

const QUARTER_HOUR = 900;
const BLOCK_SECONDS = [60, 300, 900, 3600];
export const STRIKE_MEMORY_SECONDS = 86400;

const rule = (name: string, limit: number): RateLimitRule => ({
    name,
    limit,
    windowSeconds: QUARTER_HOUR,
});

export const LIMITS = {
    loginByEmailAndAddress: rule('login:email-address', 5),
    loginByEmail: rule('login:email', 20),
    loginByAddress: rule('login:address', 50),
    resetByEmail: rule('reset:email', 3),
    resetByAddress: rule('reset:address', 10),
    refusedTokenByAddress: rule('token:address', 30),
};

const secondsUntil = (date: Date, now: Date) =>
    Math.max(0, Math.ceil((date.getTime() - now.getTime()) / 1000));

/**
 * Conta uma tentativa. Exceder o limite bloqueia por um tempo que cresce a cada
 * reincidência; tentativas durante o bloqueio não o prolongam.
 *
 * @returns o novo estado e quanto esperar, em segundos; zero libera a tentativa.
 */
export function register(
    state: RateLimitState | undefined,
    { limit, windowSeconds }: RateLimitRule,
    now: Date,
): { state: RateLimitState; retryAfterSeconds: number } {
    if (state?.blockedUntil && state.blockedUntil > now) {
        return { state, retryAfterSeconds: secondsUntil(state.blockedUntil, now) };
    }
    const age = (since: Date) => (now.getTime() - since.getTime()) / 1000;
    const remembered = state && age(state.updatedAt) < STRIKE_MEMORY_SECONDS ? state.strikes : 0;
    const sameWindow = state && !state.blockedUntil && age(state.windowStart) < windowSeconds;
    const count = sameWindow ? state.count + 1 : 1;
    const exceeded = count > limit;
    const strikes = exceeded ? remembered + 1 : remembered;
    const wait = exceeded ? BLOCK_SECONDS[Math.min(strikes, BLOCK_SECONDS.length) - 1] : 0;
    return {
        state: {
            count,
            windowStart: sameWindow ? state.windowStart : now,
            blockedUntil: exceeded ? new Date(now.getTime() + wait * 1000) : null,
            strikes,
            updatedAt: now,
        },
        retryAfterSeconds: wait,
    };
}
