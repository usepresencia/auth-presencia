import { createHash } from 'node:crypto';
import { AppError } from '../../errors/model/app.error';
import { register, type RateLimitStore, type RateLimitUse } from '../model/rate-limit';

const keyOf = ({ rule, subject }: RateLimitUse) =>
    rule.name + ':' + createHash('sha256').update(subject.toLowerCase()).digest('base64url');

export class RateLimiterService {
    constructor(private readonly store: RateLimitStore) {}

    /**
     * Conta uma tentativa em cada regra, na ordem recebida.
     *
     * @throws AppError `TOO_MANY_ATTEMPTS`, com o tempo de espera, na primeira regra excedida.
     */
    async consume(uses: RateLimitUse[]): Promise<void> {
        for (const use of uses) {
            const wait = await this.store.update(keyOf(use), state => {
                const next = register(state, use.rule, new Date());
                return { state: next.state, result: next.retryAfterSeconds };
            });
            if (wait > 0) {
                throw new AppError('TOO_MANY_ATTEMPTS', { retryAfterSeconds: wait });
            }
        }
    }

    /** Devolve a tentativa contada, sem desfazer bloqueios. */
    async refund(uses: RateLimitUse[]): Promise<void> {
        for (const use of uses) {
            const key = keyOf(use);
            if (!(await this.store.find(key))) continue;
            await this.store.update(key, state => ({
                state: { ...state!, count: Math.max(0, state!.count - 1) },
                result: undefined,
            }));
        }
    }

    async clear(use: RateLimitUse): Promise<void> {
        await this.store.delete(keyOf(use));
    }

    /** @returns segundos de bloqueio restantes, sem contar uma tentativa. */
    async blockedFor(use: RateLimitUse): Promise<number> {
        const until = (await this.store.find(keyOf(use)))?.blockedUntil?.getTime() ?? 0;
        return Math.max(0, Math.ceil((until - Date.now()) / 1000));
    }
}
