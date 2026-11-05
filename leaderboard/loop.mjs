// One hourly run of the leaderboard (.github/workflows/leaderboard.yml): a look every 10 minutes (update.mjs,
// 6 times), each one building on the last through the run's own copy of the totals (LB_CACHED_STATE), then
// the last look's site is published once. Started by the run before it (and by a half-hourly cron, as a
// backstop), so there's one run an hour and one deployment an hour, and no separate timer.
//   node leaderboard/loop.mjs <out dir>   (env: LB_LOOKS = how many looks, LB_EVERY_S = seconds apart)
import { spawn } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const OUT = process.argv[2] ?? 'site';
const LOOKS = Number(process.env.LB_LOOKS) || 6, EVERY_S = Number(process.env.LB_EVERY_S) || 600;
const UPDATE = fileURLToPath(new URL('update.mjs', import.meta.url));
const { GITHUB_OUTPUT, ...env } = process.env; // (the looks don't speak to the workflow: this does, once)
const look = () => new Promise((resolve) => {
  const p = spawn(process.execPath, [UPDATE, OUT], { env, stdio: 'inherit' });
  p.on('exit', (code) => resolve(code === 0));
});
let ok = 0;
for (let i = 0; i < LOOKS; i++) {
  const started = Date.now();
  if (await look()) ok++;
  else console.log(`look ${i + 1} failed; the next one carries on from the last good one`);
  if (i < LOOKS - 1) await new Promise((r) => setTimeout(r, Math.max(0, EVERY_S * 1000 - (Date.now() - started))));
}
console.log(`${ok} of ${LOOKS} looks done`);
if (GITHUB_OUTPUT) await appendFile(GITHUB_OUTPUT, `deploy=${ok > 0}\n`);
if (!ok) process.exit(1);
