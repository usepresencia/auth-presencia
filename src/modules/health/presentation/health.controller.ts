import { Controller, Get } from '@nestjs/common';
import { AppError } from '../../errors/model/app.error';

@Controller('health')
export class HealthController {
    @Get('live')
    live(): { status: string; service: string } {
        return { status: 'ok', service: 'auth-presencia' };
    }

    @Get('ready')
    ready(): never {
        throw new AppError('NOT_READY');
    }
}
