import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { Environment } from '../../config/environment';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
    constructor(config: ConfigService<Environment, true>) {
        const url = config.get('DATABASE_URL', { infer: true });
        if (!url) throw new Error('DATABASE_URL is required');
        super({
            adapter: new PrismaPg(
                {
                    connectionString: url,
                    application_name: 'auth-presencia',
                    max: 10,
                    connectionTimeoutMillis: 5000,
                    statement_timeout: 10000,
                    query_timeout: 15000,
                },
                { schema: new URL(url).searchParams.get('schema') ?? undefined },
            ),
        });
    }

    async onModuleDestroy(): Promise<void> {
        await this.$disconnect();
    }
}
