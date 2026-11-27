import { describe, expect, it } from 'vitest';
import { register, type RateLimitState } from '../src/modules/protection/model/rate-limit';

const rule = { name: 'fixture', limit: 3, windowSeconds: 900 };
const at = (seconds: number) => new Date(1_800_000_000_000 + seconds * 1000);

function attempts(count: number, from = 0, state?: RateLimitState) {
    let result = register(state, rule, at(from));
    for (let i = 1; i < count; i++) result = register(result.state, rule, at(from + i));
    return result;
}

describe('progressive rate limit', () => {
    it('allows attempts up to the limit', () => {
        expect(attempts(3).retryAfterSeconds).toBe(0);
    });

    it('blocks for a minute on the first excess', () => {
        expect(attempts(4).retryAfterSeconds).toBe(60);
    });

    it('reports the remaining time while blocked, without extending it', () => {
        const blocked = attempts(4);
        const later = register(blocked.state, rule, at(33));
        expect(later.retryAfterSeconds).toBe(30);
        expect(later.state).toEqual(blocked.state);
    });

    it('blocks longer each time and stops at one hour', () => {
        let result = attempts(4);
        const waits = [result.retryAfterSeconds];
        let clock = 3;
        for (let strike = 0; strike < 4; strike++) {
            clock += result.retryAfterSeconds + 1;
            result = attempts(4, clock, result.state);
            clock += 3;
            waits.push(result.retryAfterSeconds);
        }
        expect(waits).toEqual([60, 300, 900, 3600, 3600]);
    });

    it('starts a new count after the window', () => {
        const full = attempts(3);
        expect(register(full.state, rule, at(901)).state.count).toBe(1);
    });

    it('forgets earlier blocks after a quiet day', () => {
        const blocked = attempts(4);
        expect(attempts(4, 90_000, blocked.state).retryAfterSeconds).toBe(60);
    });
});
