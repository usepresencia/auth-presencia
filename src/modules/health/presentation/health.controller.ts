import { Controller, Get, Inject } from '@nestjs/common';
import { ReadinessService } from '../application/readiness.service';

const SERVICE = 'auth-presencia';

@Controller('health')
export class HealthController {
    constructor(@Inject(ReadinessService) private readonly readiness: ReadinessService) {}

    @Get('live')
    live(): { status: string; service: string } {
        return { status: 'ok', service: SERVICE };
    }

    @Get('ready')
    async ready(): Promise<{ status: string; service: string }> {
        await this.readiness.verify();
        return { status: 'ready', service: SERVICE };
    }
}
