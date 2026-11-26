import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import type { Environment } from './shared/config/environment';

async function bootstrap(): Promise<void> {
    const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
    const config = app.get(ConfigService<Environment, true>);

    configureApp(app);
    await app.listen(config.get('PORT', { infer: true }), config.get('HOST', { infer: true }));
}

bootstrap().catch(() => {
    // Do not log configuration payloads: future variables may contain secrets.
    Logger.error('Falha ao iniciar auth-presencia. Verifique a configuração e a infraestrutura.');
    process.exitCode = 1;
});
