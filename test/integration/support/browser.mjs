export class Browser {
    cookies = new Map();

    constructor({ origin } = {}) {
        this.origin = origin;
    }

    header(path) {
        return [...this.cookies.values()]
            .filter(
                c =>
                    path === c.path ||
                    path.startsWith(c.path.endsWith('/') ? c.path : c.path + '/'),
            )
            .map(c => c.value)
            .join('; ');
    }

    async request(input, { method = 'GET', headers = {}, body } = {}) {
        let url = new URL(input);
        if (this.origin) url = new URL(url.pathname + url.search, this.origin);
        const response = await fetch(url, {
            method,
            body,
            redirect: 'manual',
            headers: {
                accept: 'text/html',
                ...headers,
                cookie: this.header(url.pathname),
            },
        });
        for (const line of response.headers.getSetCookie()) {
            const parts = line.split(';').map(part => part.trim());
            const value = parts[0];
            const name = value.slice(0, value.indexOf('='));
            const path = parts.find(part => /^path=/i.test(part))?.slice(5) || '/';
            const expires = parts.find(part => /^expires=/i.test(part))?.slice(8);
            const key = name + '|' + path;
            const expired =
                value.endsWith('=') ||
                parts.some(part => /^max-age=0$/i.test(part)) ||
                (expires && Date.parse(expires) <= Date.now());
            if (expired) this.cookies.delete(key);
            else this.cookies.set(key, { path, value, attributes: parts.slice(1) });
        }
        return response;
    }
}
