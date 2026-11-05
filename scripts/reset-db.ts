/**
 * Safe database reset. Nothing is deleted: the SQLite files are moved into a
 * timestamped backpack folder so a bad migration or experiment can be undone.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const configured = process.env.DB_FILE?.trim() || 'data/recall.db';
const dbFile = path.isAbsolute(configured) ? configured : path.join(ROOT, configured);
const sources = [dbFile, `${dbFile}-wal`, `${dbFile}-shm`];
const existing = sources.filter((file) => fs.existsSync(file));

if (existing.length === 0) {
  console.log(`No database found at ${dbFile}.`);
  console.log('Nothing to reset. The app recreates the database on the first request.');
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(ROOT, 'data', 'backups', stamp);
fs.mkdirSync(backupDir, { recursive: true });

const moved: string[] = [];
for (const source of existing) {
  const target = path.join(backupDir, path.basename(source));
  try {
    fs.renameSync(source, target);
  } catch {
    // Cross-device or locked files: copy first, then remove the original.
    fs.copyFileSync(source, target);
    fs.rmSync(source, { force: true });
  }
  moved.push(path.basename(source));
}

console.log('Database reset complete (moved, not deleted).');
console.log(`  from: ${dbFile}`);
console.log(`  backup: ${backupDir}`);
for (const file of moved) console.log(`  moved: ${file}`);
console.log('');
console.log('The app recreates an empty database on the first request.');
console.log('Restore by moving the files back from the backup folder.');
