import { z } from 'zod';

export const isLoopback = (url: URL) => ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

export const redirectSchema = z.url().refine(value => {
    const url = new URL(value);
    const secure = url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url));
    return secure && !url.username && !url.password && !value.includes('#');
}, 'Redirect exige HTTPS (HTTP apenas em loopback), sem credenciais ou fragmento.');
