// Keeps the time-played leaderboard up to date on its own: GitHub Actions runs this every 10 minutes
// (.github/workflows/leaderboard.yml) and publishes the folder it writes to GitHub Pages.
//
// Each run takes one look at gtaservers.org's live NoPixel feed: who is live, as which character, and
// whether they're in the city (the feed placed them on the map in the last 2 hours). Someone live as the
// same character at this look and the last one gets the time in between; someone who started or stopped
// in between gets half of it (at most 15 minutes). The running totals (state.json) come from the
// published site itself, so nothing else has to be kept anywhere; the first run starts from seed.json.
//
// Usage: node leaderboard/update.mjs <out dir>   (writes index.html, leaderboard.json, details.json, state.json)
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pickCharacter, setCurrentCharacter } from './character.mjs';

const SITE = 'https://voidsector.github.io/NoPixel-Map-Companion/';
const FEED = 'wss://west.gtaservers.org/ws?token=nptoken';
const HERE = new URL('./', import.meta.url);
const OUT = new URL('./', pathToFileURL(resolve(process.argv[2] ?? 'site') + '/'));
const now = Math.floor(Date.now() / 1000);
const DAY = 86400, HOUR = 3600;
const CITY_S = 2 * HOUR;      // last placed on the map this long ago or less: in the city
const SAME_S = 2 * HOUR;      // live at both looks this far apart or less: live all along
const EDGE_S = 15 * 60;       // started / stopped in between: at most this much

// one character however it's written: letters and digits only ("Happy D'Klown" = "Happy Dklown")
const charWords = (ch) => String(ch ?? '').toLowerCase().normalize('NFKD').split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, '')).filter(Boolean);
const charKey = (ch) => charWords(ch).join('');
const norm = (s) => String(s ?? '').toLowerCase().replace(/["“”][^"“”]*["“”]/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
// Short forms: a streamer's character written as just the start of a longer name of theirs ("GOLDiE" of
// "Goldie Fisher"), when it starts exactly one longest name. [[id, name]] -> Map(id|key -> id|key)
function shortForms(list) {
  const byId = new Map();
  for (const [id, ch] of list) {
    const w = charWords(ch);
    if (w.length) (byId.get(id) ?? byId.set(id, new Map()).get(id)).set(w.join(''), w);
  }
  const starts = (a, b) => a.length < b.length && a.every((x, i) => x === b[i]);
  const out = new Map();
  for (const [id, names] of byId) {
    const all = [...names.values()];
    for (const [k, w] of names) {
      const longer = all.filter((b) => starts(w, b));
      const tops = longer.filter((b) => !longer.some((c) => starts(b, c)));
      if (tops.length === 1) out.set(`${id}|${k}`, `${id}|${tops[0].join('')}`);
    }
  }
  return out;
}

// ---- the totals so far: from the published site (a network failure stops the run: never start over) ----
async function loadState() {
  if (process.env.LB_STATE) return JSON.parse(await readFile(process.env.LB_STATE, 'utf8')); // testing: a state file
  const r = await fetch(`${SITE}state.json?t=${now}`, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(30_000) });
  if (r.ok) return r.json();
  if (r.status !== 404) throw new Error(`state.json: HTTP ${r.status}`);
  console.log('No published state yet: starting from seed.json');
  return JSON.parse(await readFile(new URL('seed.json', HERE), 'utf8'));
}

// ---- one look at the live feed: the roster and everyone's last position ----
function snapshot() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(FEED);
    let roster = null, done = false;
    const pos = new Map();
    const finish = (err) => {
      if (done) return;
      done = true; clearTimeout(give); clearTimeout(settle);
      try { ws.close(); } catch { /* closed */ }
      err ? reject(err) : resolve({ roster, pos });
    };
    const give = setTimeout(() => finish(roster ? null : new Error('the feed sent no roster')), 30_000);
    let settle = 0;
    ws.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') return;
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'streamers' && Array.isArray(m.streamers)) roster = m.streamers;
      if (m.type === 'positions' && Array.isArray(m.positions)) {
        for (const p of m.positions) if (typeof p?.id === 'string' && Number.isFinite(p.ts) && !(pos.get(p.id)?.ts > p.ts)) pos.set(p.id, p);
        if (roster && !settle) settle = setTimeout(() => finish(null), 6000); // a few more updates, then done
      }
    });
    ws.addEventListener('error', () => finish(new Error('the feed could not be reached')));
    ws.addEventListener('close', () => finish(roster ? null : new Error('the feed closed')));
  });
}
const getJson = (url) => fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

// ---- adding time ----
function credit(state, id, who, from, to) {
  if (to <= from) return;
  const k = `${id}|${who.k}`;
  const r = state.rows[k] ??= { s: id, n: {}, pd: false, t: 0, d: 0, ld: -1, dm: {}, hm: {} };
  r.pd ||= !!who.pd;
  r.n[who.name] = (r.n[who.name] ?? 0) + (to - from) / 60;
  r.f = Math.min(r.f ?? from, from); r.ls = Math.max(r.ls ?? 0, to);
  r.hd ??= new Array(24).fill(0);
  for (let a = from; a < to;) {
    const h = Math.floor(a / HOUR), b = Math.min(to, (h + 1) * HOUR), m = (b - a) / 60, d = Math.floor(a / DAY);
    r.t += m;
    r.hm[h] = (r.hm[h] ?? 0) + m;
    r.hd[h % 24] += m;
    r.dm[d] = (r.dm[d] ?? 0) + m;
    if (d > r.ld) { r.d++; r.ld = d; }
    a = b;
  }
}

const state = await loadState();
// state from before hours of the day, first / last seen and the city pulse were kept: those from seed.json
// (made from the full recorded history), once
if ((state.v ?? 1) < 2) {
  const seed = JSON.parse(await readFile(new URL('seed.json', HERE), 'utf8'));
  for (const [k, r] of Object.entries(state.rows)) {
    const x = seed.rows[k];
    if (!x) continue;
    if (x.hd) r.hd = x.hd.slice();
    if (x.f) r.f = Math.min(r.f ?? x.f, x.f);
    if (x.ls) r.ls = Math.max(r.ls ?? 0, x.ls);
  }
  state.pulse = seed.pulse ?? [];
  state.restarts = seed.restarts ?? [];
  state.v = 2;
}
const [{ roster, pos }, npl, wiki] = await Promise.all([snapshot(), getJson('https://nopixellink.dev/api/map'), getJson('https://wiki.gtaservers.org/nopixel-v.json')]);

// the character nopixellink reports for a live streamer (NoPixel's own), spelled as the feed spells it
const nplChar = new Map((npl?.streamers ?? []).filter((x) => x?.character_name).map((x) => [String(x.id ?? x.name ?? '').toLowerCase(), String(x.character_name).trim()]));
setCurrentCharacter((st) => {
  const np = [st.id, st.twitch?.name, st.kick?.name].map((l) => nplChar.get(String(l ?? '').toLowerCase())).find(Boolean);
  if (!np) return null;
  const n = norm(np), list = Array.isArray(st.character) ? st.character.filter(Boolean) : [];
  return list.find((c) => norm(c) === n) ?? np;
});
// police: characters the wiki lists in a police group
const PD_RE = /police|lspd|sasp|state police|park rangers?|sheriff|bcso|trooper|\bmarshals\b|marshals service/i, NOT_PD_RE = /dispatch|family/i;
const pdChars = new Set((wiki?.groups ?? []).filter((g) => PD_RE.test(g.name) && !NOT_PD_RE.test(g.name)).flatMap((g) => (g.members ?? []).map(norm)));

// who's live in the city now, as whom
const prev = state.prev ?? {};
const nowLive = {};
for (const st of roster) {
  const name = pickCharacter(st);
  if (!name || !st?.id) continue;
  const k = charKey(name), before = prev[st.id]?.k === k ? prev[st.id] : null;
  const fix = Math.max(pos.get(st.id)?.ts ?? 0, before?.fix ?? 0);
  nowLive[st.id] = { k, name, pd: pdChars.has(norm(name)), fix, city: !!fix && now - fix <= CITY_S };
}
const gap = state.at ? now - state.at : 0;
if (state.at) {
  for (const id of new Set([...Object.keys(prev), ...Object.keys(nowLive)])) {
    const a = prev[id]?.city ? prev[id] : null, b = nowLive[id]?.city ? nowLive[id] : null;
    if (a && b && a.k === b.k && gap <= SAME_S) { credit(state, id, b, state.at, now); continue; }
    const half = Math.min(gap / 2, EDGE_S);
    if (a) credit(state, id, a, state.at, state.at + half);
    if (b) credit(state, id, b, now - half, now);
  }
}
state.at = now;
state.prev = nowLive;
// the city pulse: how many were on the map at each look (placed in the last 2 minutes), the last 7 days;
// a restart: everyone off at once (under a quarter of the half hour before, with 20+ on before)
const onMap = roster.filter((st) => now - (pos.get(st.id)?.ts ?? 0) <= 120).length;
state.pulse ??= []; state.restarts ??= [];
const before30 = state.pulse.filter(([t]) => now - t <= 35 * 60).map(([, n]) => n).sort((a, b) => a - b);
const med = before30[before30.length >> 1] ?? 0;
if (before30.length >= 2 && med >= 20 && onMap < med * 0.25 && now - (state.restarts.at(-1) ?? 0) > 3 * HOUR) state.restarts.push(now);
state.pulse.push([now, onMap]);
state.pulse = state.pulse.filter(([t]) => now - t <= 7 * DAY);
state.restarts = state.restarts.filter((t) => now - t <= 7 * DAY);
// pictures (Twitch / Kick only)
state.avatars ??= {};
for (const st of roster) if (st.avatar && /^https:\/\/(static-cdn\.jtvnw\.net|files\.kick\.com)\//.test(st.avatar)) state.avatars[st.id] = st.avatar;
// only the last 31 days / 25 hours are needed per row
const today = Math.floor(now / DAY), hourNow = Math.floor(now / HOUR);
for (const r of Object.values(state.rows)) {
  for (const d of Object.keys(r.dm)) if (d < today - 31) delete r.dm[d];
  for (const h of Object.keys(r.hm)) if (h < hourNow - 25) delete r.hm[h];
}

// ---- the page's data: one row per streamer and character (spellings and short forms joined) ----
const groups = new Map();
const short = shortForms(Object.values(state.rows).flatMap((r) => Object.keys(r.n).map((n) => [r.s, n])));
for (const [key, r] of Object.entries(state.rows)) {
  const to = short.get(key) ?? key;
  const g = groups.get(to) ?? groups.set(to, { s: r.s, n: {}, pd: false, d: 0, on: [0, 0, 0, 0], p7: 0, dm: new Array(30).fill(0), hd: new Array(24).fill(0), f: Infinity, ls: 0 }).get(to);
  for (const [n, m] of Object.entries(r.n)) g.n[n] = (g.n[n] ?? 0) + m;
  g.pd ||= r.pd;
  g.d = Math.max(g.d, r.d);
  g.on[0] += r.t;
  g.f = Math.min(g.f, r.f ?? Infinity); g.ls = Math.max(g.ls, r.ls ?? 0);
  (r.hd ?? []).forEach((m, i) => { g.hd[i] += m; });
  for (const [d, m] of Object.entries(r.dm)) {
    if (d > today - 30) { g.on[1] += m; g.dm[29 - (today - d)] += m; }
    if (d > today - 7) g.on[2] += m; else if (d > today - 14) g.p7 += m; // (the 7 days before: who's rising)
  }
  for (const [h, m] of Object.entries(r.hm)) if (h > hourNow - 24) g.on[3] += m;
}
const rows = [...groups.values()].map((g) => ({ ...g, c: Object.entries(g.n).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null, on: g.on.map(Math.round) }))
  .filter((g) => g.c && g.on[0] >= 1).sort((a, b) => b.on[0] - a.on[0]);
const used = new Set(rows.map((r) => r.s));
const data = {
  v: 2, made: now, since: state.since, periods: ['all', '30d', '7d', '24h'],
  live: Object.entries(nowLive).filter(([id, w]) => w.city && used.has(id)).map(([id]) => id),
  avatars: Object.fromEntries(Object.entries(state.avatars).filter(([l]) => used.has(l))),
  // [streamer, character, police, days, [minutes: all, 30 d, 7 d, 24 h], minutes the 7 days before]
  rows: rows.map((r) => [r.s, r.c, r.pd ? 1 : 0, r.d, r.on, Math.round(r.p7)]),
  pulse: state.pulse.map(([t, n]) => [t, n]), restarts: state.restarts,
};
// a character's page (fetched when one is opened): minutes per day for the last 30 (oldest first, the last
// is today, UTC), minutes per hour of the day (UTC, all time), first and last seen
const details = { today, rows: Object.fromEntries(rows.map((r) => [`${r.s}|${r.c}`, { dm: r.dm.map(Math.round), hd: r.hd.map(Math.round), f: Number.isFinite(r.f) ? Math.round(r.f) : null, ls: Math.round(r.ls) || null }])) };
// a drop means something went wrong: don't publish it over the good totals
const before = state.made ?? 0;
state.made = now;
if (state.total && data.rows.reduce((t, r) => t + r[4][0], 0) < state.total * 0.99) throw new Error('the totals went down: not publishing');
state.total = data.rows.reduce((t, r) => t + r[4][0], 0);

await mkdir(OUT, { recursive: true });
await copyFile(new URL('index.html', HERE), new URL('index.html', OUT));
await writeFile(new URL('leaderboard.json', OUT), JSON.stringify(data));
await writeFile(new URL('details.json', OUT), JSON.stringify(details));
await writeFile(new URL('state.json', OUT), JSON.stringify(state));
await writeFile(new URL('.nojekyll', OUT), '');
console.log(`${roster.length} live, ${data.live.length} in the city; ${data.rows.length} characters; ${Math.round(gap / 60)} min since the last look${before ? '' : ' (first run)'}`);
