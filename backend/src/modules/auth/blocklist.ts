// Offline whole-password blocklist (P-4). INTERIM SEED ONLY: the real source, licence, size and update process are
// PENDING (P-4a/b). Entries are stored case-folded (P-4d) and only entries of 15+ code points matter, since shorter
// passwords are already rejected by length. Matching is whole-password, never substring.

const SEED = [
  '123456789012345', '1234567890123456', '12345678901234567890', '111111111111111', '000000000000000',
  '123123123123123', '123412341234123', 'abcdefghijklmno', 'abcdefghijklmnop', 'abc123abc123abc',
  'qwertyuiopasdfg', 'qwertyuiopasdfgh', 'qwertyuiopasdfghjkl', 'qwertyqwertyqwerty', 'asdfghjklqwerty',
  '1qaz2wsx3edc4rfv', 'qazwsxedcrfvtgb', 'zaq12wsxcde34rfv', 'aaaaaaaaaaaaaaa', 'passwordpassword',
  'password1234567', 'password12345678', 'password123456789', 'mypassword12345', 'iloveyou12345678',
  'welcome12345678', 'administrator123', 'administrator1234', 'adminadminadmin', 'changeme12345678',
  'letmein123456789', 'matkhau123456789', 'matkhau1234567890', 'matkhaumoi123456', 'matkhaumoi12345678',
  'matkhaucuatoi123', 'matkhaucuatoi1234', 'toilanguoivietnam', 'vietnamvodich123', 'anhyeuem12345678',
  'emyeuanh12345678', 'xinchao123456789', 'hanoi123456789012', 'saigon1234567890',
];

export const OFFLINE_BLOCKLIST: ReadonlySet<string> = new Set(SEED.map((entry) => entry.normalize('NFC').toLowerCase()));
