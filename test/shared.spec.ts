import { describe, expect, it } from 'vitest';
import { pickConfig } from '../src/shared/config/pick-config';
import { errorName } from '../src/shared/utils/error-name';

describe('shared helpers', () => {
    it('names an error without exposing its message', () => {
        expect(errorName(new TypeError('sensitive'))).toBe('TypeError');
        expect(errorName('sensitive')).toBe('desconhecida');
    });

    it('picks only the requested configuration keys', () => {
        const values: Record<string, unknown> = { PORT: 3340, HOST: 'localhost' };
        const config = { get: (key: string) => values[key] } as never;
        expect(pickConfig(config, 'PORT')).toEqual({ PORT: 3340 });
    });
});
