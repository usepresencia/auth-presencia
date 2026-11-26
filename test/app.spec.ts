import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';

describe('application foundation', () => {
    let app: INestApplication;

    beforeAll(async () => {
        const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = module.createNestApplication();
        await app.init();
    });

    afterAll(async () => {
        await app?.close();
    });

    it('exposes parsed configuration objects through ConfigService', () => {
        const clients = app.get(ConfigService).get('AUTH_CLIENTS');
        expect(clients[0].clientId).toBe('web-kontal');
        expect(app.get(ConfigService).get('AUTH_COOKIE_KEYS')).toHaveLength(1);
    });

    it('reports process liveness', async () => {
        const response = await request(app.getHttpServer()).get('/health/live').expect(200);
        expect(response.body).toEqual({ status: 'ok', service: 'auth-presencia' });
    });

    it('does not advertise readiness before OIDC and persistence exist', async () => {
        const response = await request(app.getHttpServer()).get('/health/ready').expect(503);
        expect(response.body.status).toBe('not_ready');
    });

    it.each(['/authorize', '/token', '/.well-known/openid-configuration'])(
        'does not expose an unfinished OIDC endpoint %s',
        async path => {
            await request(app.getHttpServer()).get(path).expect(404);
        },
    );
});
