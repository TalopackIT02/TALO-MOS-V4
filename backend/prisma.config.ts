import { defineConfig } from 'prisma/config';

// IAM v0.3 is managed outside Prisma (database/sql). Prisma is used for introspection and the client only:
// never run `prisma migrate *` or `prisma db push` against this project.
// Prisma 7 does not load .env files; DATABASE_URL must be present in the process environment
// (it is optional here so `prisma validate` / `prisma generate` work without a database).
export default defineConfig({
  schema: '../database/prisma/schema.prisma',
  datasource: {
    url: process.env['DATABASE_URL'],
  },
});
