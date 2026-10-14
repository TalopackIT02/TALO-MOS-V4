import { createPwnedFixture, removePwnedFixture } from './pwnedFixture.js';

// For the browser E2E config: `tsx test/support/pwnedFixtureCli.ts create` prints the directory of a synthetic
// Pwned-Passwords-format fixture (OS temp, outside Git); `remove <dir>` deletes it (guarded).

async function main(): Promise<void> {
  const [command, dir] = process.argv.slice(2);
  if (command === 'create') process.stdout.write(`${await createPwnedFixture()}\n`);
  else if (command === 'remove' && dir) await removePwnedFixture(dir);
  else throw new Error('usage: pwnedFixtureCli.ts create | remove <dir>');
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : 'error'}\n`);
  process.exit(1);
});
