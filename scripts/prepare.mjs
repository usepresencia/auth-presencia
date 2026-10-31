import { existsSync } from 'node:fs';

if (process.env.NODE_ENV !== 'production' && process.env.CI !== 'true' && existsSync('.git')) {
    const { default: husky } = await import('husky');
    husky();
}
