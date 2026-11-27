import { errors } from 'oidc-provider';
import type { ClientConfig } from '../../../../shared/config/clients';

export type ClientRegistry = (clientId: string) => ClientConfig;

export function clientRegistry(clients: ClientConfig[]): ClientRegistry {
    const byId = new Map(clients.map(client => [client.clientId, client]));
    return clientId => {
        const config = byId.get(clientId);
        if (!config) throw new errors.InvalidClient('unknown client');
        return config;
    };
}
