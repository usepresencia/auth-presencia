export class IdentityDisabledError extends Error {
    constructor() {
        super('Identidade desativada.');
        this.name = 'IdentityDisabledError';
    }
}
