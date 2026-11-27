import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// `prisma generate` não precisa de banco (CI e build da imagem); migrations precisam.
export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: { path: 'prisma/migrations' },
    ...(process.env.DATABASE_URL ? { datasource: { url: process.env.DATABASE_URL } } : {}),
});
