import { AppError } from '../../errors/model/app.error';
import type { ReadinessCheck } from '../model/readiness';

export class ReadinessService {
    constructor(private readonly check: ReadinessCheck) {}

    async verify(): Promise<void> {
        try {
            await this.check.verify();
        } catch (error) {
            throw new AppError('NOT_READY', { cause: error });
        }
    }
}
