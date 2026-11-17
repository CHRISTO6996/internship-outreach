import fs from 'node:fs';
import path from 'node:path';
import { databasePath, dataDir, resumeDir, uploadDir } from '../config.js';

function removeIfExists(target) {
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
}

function clearDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir)) {
    fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
  }
}

removeIfExists(databasePath);
removeIfExists(`${databasePath}-wal`);
removeIfExists(`${databasePath}-shm`);
removeIfExists(`${databasePath}-journal`);
clearDir(resumeDir);
clearDir(uploadDir);

// Recreate the schema immediately so the next start has clean tables.
await import('./index.js');

console.log(`Reset complete. Database recreated at ${path.relative(dataDir, databasePath) || databasePath}.`);
