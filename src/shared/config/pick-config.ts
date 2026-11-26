import type { ConfigService } from '@nestjs/config';
import type { Environment } from './environment';

/** Lê do `ConfigService` somente as chaves pedidas, já tipadas. */
export function pickConfig<K extends keyof Environment>(
    config: ConfigService<Environment, true>,
    ...keys: K[]
): Pick<Environment, K> {
    return Object.fromEntries(
        keys.map(key => [key, config.get(key as keyof Environment, { infer: true })]),
    ) as Pick<Environment, K>;
}
