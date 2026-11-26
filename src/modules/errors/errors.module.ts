import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import type { Environment } from '../../shared/config/environment';
import { pickConfig } from '../../shared/config/pick-config';
import { RecordErrorService } from './application/record-error.service';
import { createErrorLogSink } from './infrastructure/firestore-error-log.writer';
import { ERROR_LOG_SINK, type ErrorLogSink } from './model/error-log';
import { GlobalExceptionFilter } from './presentation/global-exception.filter';

@Module({
    providers: [
        {
            provide: ERROR_LOG_SINK,
            useFactory: (config: ConfigService<Environment, true>) =>
                createErrorLogSink(
                    pickConfig(
                        config,
                        'FIREBASE_PROJECT_ID',
                        'FIREBASE_CLIENT_EMAIL',
                        'FIREBASE_PRIVATE_KEY',
                        'FIREBASE_AUTH_EMULATOR_HOST',
                        'FIRESTORE_EMULATOR_HOST',
                    ),
                ),
            inject: [ConfigService],
        },
        {
            provide: RecordErrorService,
            useFactory: (sink: ErrorLogSink) => new RecordErrorService(sink),
            inject: [ERROR_LOG_SINK],
        },
        { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    ],
    exports: [RecordErrorService],
})
export class ErrorsModule {}
