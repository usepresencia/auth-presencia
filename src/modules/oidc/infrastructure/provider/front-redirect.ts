interface FrontRedirect {
    status: number;
    body: unknown;
    type: string;
    set(name: string, value: string): void;
}

export function redirectToFront(ctx: FrontRedirect, location: string): void {
    ctx.status = 303;
    ctx.set('location', location);
    ctx.body = '';
    ctx.type = 'text/plain';
}
