import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

@Controller('health')
export class HealthController {
    @Get('live')
    live(): { status: string; service: string } {
        return { status: 'ok', service: 'auth-presencia' };
    }

    @Get('ready')
    ready(): never {
        throw new ServiceUnavailableException({
            status: 'not_ready',
            reason: 'OIDC provider and persistence are not configured yet.',
        });
    }
}
