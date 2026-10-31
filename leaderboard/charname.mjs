// A character's name from a stream title, for when the title names none of the streamer's listed
// characters: "MR C. -- Casino and the great Auction" -> "Mr. C", "Senior Officer Gregor Hamilton |
// LSPD" -> "Gregor Hamilton", "DANTE CROSS IS A MENACE" -> "Dante Cross". The title is cut into
// segments (at | - : / and emoji); server, game and stream words are dropped; ranks in front are
// dropped too; a segment that is a short run of name-like words (or starts with one, before an
// ordinary word: "SEAN CODY ON NOPIXEL") is the name. Better nothing than a guess: hype ("BIG DAY",
// "LOCKING UP THE WHOLE CITY"), single shouted words ("TRAPPING") and sentences give null.
// Used by the page and the server.

// stream / server / game words: dropped wherever they are
const NOISE = new Set(`nopixel nopixelwl nopixelv np npv npwl wl gta gtav gtarp gta5 rp roleplay fivem v iv 4.0 5.0 v5 public green whitelist
  prodigy onx onxrp pma pmarp westside capital travessia cuh munity server servers
  live stream streaming streamer multistream multistreaming multi subathon subathons sub subs subscribe follow follows goal day days
  episode ep part chapter season vod vods clip clips socials social discord youtube yt twitter tiktok insta merch drops cards tip tts
  podcast playlist song throne gg kick twitch pc ps5 vtuber cam psec`.split(/\s+/));
// ordinary words: a name stops before one ("SEAN CODY ON NOPIXEL"), and a segment made of them isn't a name
const COMMON = new Set(`a an the and or but nor not no yes is are was were be been am it its it's this that these those there here then than
  to of in on at by for with without from into onto up down out over under off about after before again still just only also too very so
  as if when while who what why how all any some more most less many much few each every other another same new old big small little
  good bad best worst great huge mega super insane crazy wild hype epic chill chaos chaotic gaming gameplay game games play plays playing
  today tonight tomorrow yesterday now later soon late early night morning evening week weekend month year time times
  monday tuesday wednesday thursday friday saturday sunday mon tue wed thu fri sat sun
  back home return returns returning first last final finals next one two three again ever never always forever
  boss man woman king queen lord lady guy girl boy kid family gang crew team squad crime crimes cops cop pd police lspd bcso sasp ems doctor
  job jobs work working money cash bank banks heist heists robbery rob robs robbing casino gamba auction gala party event events masquerade ball
  city town street streets road maze empire world life nolife chud smol strem stuff things vibes vibe vibing hi hello hey omg lol lmao
  get gets got go goes going went come comes coming make makes making do does doing did try tries trying need needs want wants see sees
  win wins lose loses take takes run runs give giving thanks thank locking lock locked figuring update updates arc arcs story lore
  dungeon master dungeonmaster dm halloween thrills christmas birthday anniversary affiliate partner push problems confusion connection
  menace cancelled ready nobody somebody everyone everybody someone anything nothing something stuff well rested bonus pov owner
  you your yours me my mine we our us they them their he him his she her i ur u cute
  can't cant won't wont don't dont isn't keep lobby hour hours minute minutes bit stake member members friendly
  january february march april may june july august september october november december
  hopefully totally finally literally really actually basically probably maybe`.split(/\s+/));
// ranks and roles in front of a name: dropped ("Officer Ruby York" -> "Ruby York")
const RANKS = new Set(`officer senior snr junior jr sgt sergeant lt lieutenant capt captain cpt chief deputy trooper ranger cadet detective det
  commissioner commander cmdr marshal sheriff warden agent doc doctor dr lawyer judge mayor councilman councilwoman nurse medic emt paramedic
  swat lead head oiler of police`.split(/\s+/));
const TITLES = { mr: 'Mr.', mrs: 'Mrs.', ms: 'Ms.', miss: 'Miss', dr: 'Dr.' };
// after a name these belong to it ("Charles Dawson Jr" is not "Charles Dawson"), though in front "Junior" is a rank
const SUFFIXES = new Set(['jr', 'junior', 'sr', 'senior', 'ii', 'iii']);

const wordKey = (w) => w.toLowerCase().replace(/[^a-z0-9'.]/g, '').replace(/\.$/, '');
const looksLikeName = (w) => /^\p{Script=Latin}[\p{Script=Latin}'’.\-]*$/u.test(w) && !/['’]s$/i.test(w); // letters (O'Connor, D'Stellano); not a possessive
function tidy(words) {
  // shouted (ALL CAPS) or all lower case: give it name capitals; mixed case stays as written (DeVito, VonBoom)
  return words.map((w) => {
    const key = wordKey(w).replace(/\./g, '');
    if (TITLES[key]) return TITLES[key];
    if (/^(ii|iii|iv)$/.test(key)) return key.toUpperCase(); // John Smith III
    if (w === w.toUpperCase() || w === w.toLowerCase()) return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    return w;
  }).join(' ').replace(/\.$/, '');
}

export function titleCharacter(title, streamerId = '') {
  if (!title) return null;
  const own = String(streamerId).toLowerCase().replace(/[^a-z]/g, '');
  let t = String(title)
    .replace(/https?:\/\/\S+/g, ' | ')
    .replace(/[!#@][\w-]+/g, ' | ')                       // !commands, #tags, @handles
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' | ')              // [tags] (asides)
    .replace(/["“”][^"“”]{0,40}["“”]/g, ' ')              // "nicknames" inside a name: Ellis "Old Man" Pinzon -> Ellis Pinzon
    .replace(/[^\p{Script=Latin}\p{N}\s'’.\-:|/]/gu, ' | ') // emoji, symbols and other scripts separate
    .replace(/\s(-{1,3}|–|—|~|\/\/?|\|\|?|║|:|\bl\b)\s/g, ' | ') // " - ", " -- ", " / ", " l "
    .replace(/(\S):\s/g, '$1 | ')                          // "VERTiiGO: Bazz"
    .replace(/[|/]/g, ' | ');
  const segments = t.split('|').map((s) => s.trim()).filter(Boolean);
  const isTitle = (w) => !!TITLES[wordKey(w).replace(/\./g, '')];
  const ownName = (w) => {
    const k = wordKey(w).replace(/[^a-z]/g, '');
    if (!own || k.length < 4) return false;
    if (own.startsWith(k) || k.startsWith(own)) return true;
    for (let i = 0; i + 5 <= k.length; i++) if (own.includes(k.slice(i, i + 5))) return true; // "PickleTuber" for ruffpickle
    return false;
  };
  let meaningful = 0, prefixName = null;
  for (const seg of segments) {
    let words = seg.split(/\s+/).map((w) => w.replace(/^[-.']+|[-']+$/g, '')).filter((w) => w && !NOISE.has(wordKey(w)) && !/^\d/.test(w) && !/^[+.]/.test(w));
    while (words.length && /^(its|it's|it’s|im|i'm|aka)$/i.test(words[0])) words.shift(); // "Its Nico Lee"
    if (!words.length) continue;                         // nothing but stream / server words
    if (++meaningful > 2) break;                         // a name comes early in a title
    while (words.length > 1 && RANKS.has(wordKey(words[0]))) words.shift();          // "Chief of Police Mike Bayo"
    if (words.length === 1 && ownName(words[0])) break;  // the streamer's own name (or brand) where a character would be
    // the name: the words up to the first ordinary word, without a role at its end ("Scotty Bard Warden")
    const name = [];
    for (const w of words) {
      if (COMMON.has(wordKey(w)) || !looksLikeName(w)) break;
      name.push(w);
    }
    const whole = name.length === words.length;
    while (name.length > 1 && RANKS.has(wordKey(name[name.length - 1])) && !SUFFIXES.has(wordKey(name[name.length - 1]))) name.pop();
    if (!name.length || name.length > 4) continue;
    if (name.length === 1) {
      const w = name[0];
      if (!whole || isTitle(w) || w.length < 3) continue;  // one word before a sentence ("LOCKING up the...") isn't enough
      if (w === w.toUpperCase() && segments.length > 1) continue; // a lone shouted word ("TRAPPING", "UPTOWN") is hype
    }
    if (whole) return tidy(name);                        // a segment that is just a name: that's it
    prefixName ??= tidy(name);                           // "DANTE CROSS is a menace": unless a later segment is just a name
  }
  return prefixName;
}

