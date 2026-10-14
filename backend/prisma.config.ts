import { defineConfig } from 'prisma/config';

// Disable the CLI update check/banner on every platform (PowerShell, cmd, Linux) without shell-specific syntax.
process.env['CHECKPOINT_DISABLE'] ??= '1';
process.env['PRISMA_HIDE_UPDATE_MESSAGE'] ??= '1';

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
