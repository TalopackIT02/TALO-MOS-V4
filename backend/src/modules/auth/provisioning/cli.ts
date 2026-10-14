import { createPrismaClient } from '../../../infrastructure/prisma/client.js';
import type { Prisma, PrismaClient } from '../../../infrastructure/prisma/generated/client.js';
import { PasswordHasher } from '../passwordHasher.js';
import { ProvisioningError, provisionAccount } from './provisionAccount.js';
import type { SqlExecutor } from './provisionAccount.js';

// IT provisioning CLI (P-4e). Runs as role talo_provisioner via PROVISIONER_DATABASE_URL (never talo_app / admin).
//   npm run provision:account -- --employee-code NV0001 --full-name "Nguyễn Văn A" --username nv0001 --joined-at 2026-10-01
// The temporary password is printed ONCE, only to an interactive terminal (refused when stdout is redirected, so it
// cannot end up in a file or CI log). Hand it over through a separate channel after verifying the recipient.

function prismaExecutor(db: PrismaClient | Prisma.TransactionClient): SqlExecutor {
  return {
    query: (sql, params) => db.$queryRawUnsafe<Record<string, string | null>[]>(sql, ...params),
    transaction: (work) => {
      if (!('$transaction' in db)) throw new Error('nested transaction');
      return db.$transaction((tx) => work(prismaExecutor(tx)), { isolationLevel: 'ReadCommitted' });
    },
  };
}

function arg(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const url = process.env['PROVISIONER_DATABASE_URL'];
  if (!url) throw new ProvisioningError('PROVISIONER_DATABASE_URL is not set');
  if (decodeURIComponent(new URL(url).username) !== 'talo_provisioner') throw new ProvisioningError('PROVISIONER_DATABASE_URL must use role talo_provisioner');
  if (!process.stdout.isTTY) throw new ProvisioningError('refusing to print a temporary password to a non-interactive output');
  const employeeCode = arg(args, 'employee-code');
  const fullName = arg(args, 'full-name');
  const username = arg(args, 'username');
  const joinedAt = arg(args, 'joined-at');
  const employeeId = arg(args, 'employee-id');
  if (!employeeCode || !fullName || !username || !joinedAt) {
    throw new ProvisioningError('usage: --employee-code <code> --full-name "<name>" --username <login> --joined-at YYYY-MM-DD [--employee-id <uuid>]');
  }
  const prisma = createPrismaClient(url);
  try {
    const [who] = await prisma.$queryRawUnsafe<{ usr: string }[]>('SELECT current_user AS usr');
    if (who?.usr !== 'talo_provisioner') throw new ProvisioningError('connected role is not talo_provisioner');
    const hasher = new PasswordHasher();
    const result = await provisionAccount(prismaExecutor(prisma), hasher,
      { employeeCode, fullName, username, joinedAt, ...(employeeId ? { employeeId } : {}) });
    process.stdout.write([
      `Đã cấp tài khoản ${result.username} (PROVISIONED, bắt buộc đổi mật khẩu ở lần đăng nhập đầu).`,
      `Mật khẩu tạm (chỉ hiển thị một lần): ${result.temporaryPassword}`,
      'Bàn giao qua kênh riêng sau khi xác minh người nhận. Không chụp màn hình, không lưu, không gửi kèm tên đăng nhập.',
      '',
    ].join('\n'));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof ProvisioningError ? error.message : 'provisioning failed'}\n`);
  process.exit(1);
});
