import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AppError } from '../../errors/model/app.error';
import type { Environment } from '../../../shared/config/environment';

@Injectable()
export class OriginGuard implements CanActivate {
    private readonly origin: string;

    constructor(@Inject(ConfigService) config: ConfigService<Environment, true>) {
        this.origin = new URL(config.get('AUTH_ISSUER', { infer: true })).origin;
    }

    canActivate(context: ExecutionContext): boolean {
        const request = context.switchToHttp().getRequest<Request>();
        if (request.method === 'GET' || request.method === 'HEAD') return true;
        if (request.headers.origin !== this.origin) {
            throw new AppError('ORIGIN_NOT_ALLOWED');
        }
        return true;
    }
}
