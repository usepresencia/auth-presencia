import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';

describe('application foundation', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
        const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = module.createNestApplication<NestExpressApplication>({ bodyParser: false });
        configureApp(app);
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

    it('publishes the discovery document', async () => {
        const response = await request(app.getHttpServer())
            .get('/.well-known/openid-configuration')
            .expect(200);
        expect(response.body.issuer).toBe('http://localhost:3340');
    });

    it('rejects an authorization request without parameters', async () => {
        const response = await request(app.getHttpServer()).get('/authorize').expect(303);
        expect(response.headers['location']).toBe('/error?error=invalid_request');
    });

    it.each(['/unknown', '/authorized', '/tokens', '/session/end', '/reg'])(
        'does not expose %s',
        async path => {
            await request(app.getHttpServer()).get(path).expect(404);
        },
    );
});
