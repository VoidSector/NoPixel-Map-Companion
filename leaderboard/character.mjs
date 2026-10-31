// The character a streamer is playing right now (the server's copy of the page's currentCharacter).
// The feed lists every character a streamer has ever played. Which one is live comes from the stream
// title, which on NoPixel nearly always names the character ("Officer Ruby York | NoPixel"):
// a full name, a quoted nickname, the surname, the first name or the initials ("JP") count, in that
// order of weight. One character: that's it. No clear winner: the name the title gives (charname.mjs), or null.
import { titleCharacter } from './charname.mjs';
const NAME_STOP = new Set(['the', 'and', 'for', 'with', 'van', 'von', 'del', 'mr', 'mrs', 'big', 'lil', 'little', 'officer', 'deputy',
  'trooper', 'cadet', 'sgt', 'chief', 'captain', 'doc', 'nopixel', 'gta', 'npv']);
const titleText = (t) => ` ${String(t ?? '').toLowerCase().normalize('NFKD').replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim()} `;
const cache = new Map(); // id -> { key, name }

// A short form of a nickname in the title: the same first letter and the same ending ("DHead" for
// "Dickhead"). Only for nicknames in quotes, and only whole words of the title.
// A nickname blended from the first name and the surname: the first name's start and the surname's end
// ("Chodie" for Chad Brodie, "Jebo" for Jeff Bo..). A whole word of the title, 4+ letters, at least 2
// letters from the first name and 3 from the surname, and not just one of the two names.
// Other names of characters (the wiki's aliases), set by the server: { character: [names] }
let charAliasMap = {};
// The character a live streamer is playing as NoPixel's own system reports it (set by the server; it wins)
let currentHook = null;
export function setCurrentCharacter(fn) { currentHook = typeof fn === 'function' ? fn : null; }
export function setCharacterAliases(m) { charAliasMap = m && typeof m === 'object' ? m : {}; cache.clear(); }
function blendNick(title, plain) {
  const parts = plain.trim().split(' ').filter((w) => w.length >= 2);
  if (parts.length < 2) return false;
  const first = parts[0], last = parts.at(-1);
  if (last.length < 4) return false;
  return title.trim().split(' ').some((w) => {
    if (w.length < 4 || w === first || w === last) return false;
    for (let i = 2; i <= Math.min(first.length, w.length - 3); i++) {
      if (w.slice(0, i) === first.slice(0, i) && last.endsWith(w.slice(i)) && w.slice(i).length < last.length) return true;
    }
    return false;
  });
}
function nickShort(title, nick) {
  const n = titleText(nick).trim().replace(/ /g, '');
  if (n.length < 5) return false;
  return title.trim().split(' ').some((w) => w.length >= 4 && w.length < n.length && w[0] === n[0] && n.endsWith(w.slice(1)));
}
export function pickCharacter(s) {
  const reported = currentHook?.(s);
  if (reported) return reported;
  const chars = Array.isArray(s?.character) ? s.character.filter(Boolean) : [];
  if (chars.length === 1) return chars[0];
  if (!chars.length) return titleCharacter([s?.twitch?.title, s?.kick?.title].find(Boolean), s?.id);
  const title = titleText([s.twitch?.title, s.kick?.title].filter(Boolean).join(' '));
  const key = `${title}|${chars.join('|')}`;
  const hit = cache.get(s.id);
  if (hit?.key === key) return hit.name;
  let best = null, second = 0;
  for (const c of chars) {
    const plain = titleText(c.replace(/["“”][^"“”]*["“”]/g, ' '));
    const words = plain.trim().split(' ').filter((w) => w.length >= 3 && !NAME_STOP.has(w));
    let score = title.includes(plain) && plain.trim().includes(' ') ? 10 : 0;
    const nick = c.match(/["“](.+?)["”]/)?.[1];
    if (nick && title.includes(titleText(nick))) score += 6;
    else if (nick && nickShort(title, nick)) score += 6; // "DHead" for "Dickhead"
    words.forEach((w, i) => { if (title.includes(` ${w} `)) score += i === words.length - 1 ? 3 : 2; });
    const initials = plain.trim().split(' ').map((w) => w[0]).join('');
    if (initials.length >= 2 && title.includes(` ${initials} `)) score += 2;
    if (blendNick(title, plain)) score += 4; // "Chodie" for Chad Brodie
    if ((charAliasMap[c] ?? []).some((al) => { const w = titleText(al).trim(); return w.length >= 3 && title.includes(` ${w} `); })) score += 6; // another name the wiki gives them
    if (!best || score > best.score) { second = best?.score ?? 0; best = { c, score }; } else if (score > second) second = score;
  }
  const name = best && best.score >= 2 && best.score > second ? best.c : titleCharacter([s.twitch?.title, s.kick?.title].find(Boolean), s.id);
  if (cache.size > 5000) cache.clear();
  cache.set(s.id, { key, name });
  return name;
}
