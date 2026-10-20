// Vitrine AR/SAR — collection de cartes Pokémon « Illustration rare » et « Illustration spéciale rare ».
// Données : TCGdex (cartes FR / JA / EN + prix Cardmarket), noms FR du Pokédex : data/pokedex.json, illustrations : PokéAPI.
//
// Modèle : une « carte » (entrée du catalogue) = une illustration, qui peut exister en plusieurs langues (variantes).
//   entrée  = { k, d:[n° pokédex], n, r:type, v:{ fr?, ja?, en? } }       variante = { id, i|u, l:n°, s:extension }
// Ce que possède l'utilisateur = des variantes précises (« fr:sv03.5-166 », « ja:SV2a-166 »…), pas des entrées.

const API = 'https://api.tcgdex.net/v2';
const RARITIES = [
  { fr: 'Illustration rare', en: 'Illustration rare', code: 'AR' },
  { fr: 'Illustration spéciale rare', en: 'Special illustration rare', code: 'SAR' },
];
const LANGS = ['fr', 'ja', 'en'];                       // ordre de préférence : français, japonais, anglais
const LNAME = { fr: 'Français', ja: 'Japonais', en: 'Anglais' };
const LCODE = { fr: 'FR', ja: 'JP', en: 'EN' };
const ARTWORK = n => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${n}.png`;
const MIN_DEX = 1025;
const CATALOG_VERSION = 4;
const DATA_V = 4;                         // à incrémenter quand un fichier de data/ change (évite qu'un navigateur garde l'ancienne version en cache)
const CATALOG_MAX_AGE = 10 * 60 * 1000;   // pas de re-téléchargement du catalogue en dessous de 10 min
const PRICE_TTL = 30 * 60 * 1000;         // un prix est considéré frais 30 min
const DAY = 86400000;

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const eur = n => n == null ? null : n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const TYPES = { AR: 'AR', SAR: 'SAR', ALT: 'ALT', GAL: 'GAL', PRM: 'PRM', SCN: 'SCÈNE', PERSO: 'PERSO' };
const rar = r => TYPES[r] || r;
const pad = n => String(n).padStart(3, '0');
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;
const numOf = s => parseInt(String(s).replace(/\D/g, '')) || 0;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota / mode privé */ } },
};
const vkey = (l, id) => `${l}:${id}`;
const migrate = a => (Array.isArray(a) ? a : []).filter(x => typeof x === 'string').map(x => x.includes(':') ? x : vkey('fr', x));

// ---------- État ----------
let pokedex = {};                         // { "25": "Pikachu" }
let legacy = [];                          // cartes d'avant Écarlate et Violet (listes fixes : data/legacy-*.json)
let jaBase = { meta: {}, sets: {} };      // métadonnées des cartes japonaises connues (data/ja-meta.json)
let jaMeta = store.get('jaMeta', {});     // idem, ajouts faits sur cet appareil
let catalog = store.get('catalog', null); // { v, t, cards: [entrées], sets: {...} }
if (catalog && catalog.v !== CATALOG_VERSION) catalog = null;
let custom = store.get('custom', []);     // cartes ajoutées à la main (propres à cet appareil)
let owned = new Set(migrate(store.get('owned', [])));   // variantes possédées
let wish = new Set(migrate(store.get('wish', [])));     // variantes recherchées (une variante = possédée OU recherchée)
let prices = store.get('prices', {});     // { 'fr:id': { t, tr, avg, low, a1, a7, a30, up } }
let backup = store.get('backup', { last: 0, since: 0, n: 0, snooze: 0 });
let byDex = new Map(), byKey = new Map(), byVer = new Map(), bySet = new Map();
let extraSets = {};
let maxDex = MIN_DEX;
let filter = 'all', typeFilter = '', mode = 'dex', query = '', tab = 'dex';

// ---------- Outils sur les entrées ----------
const langsOf = e => LANGS.filter(l => e.v[l]);
const prefLang = e => langsOf(e)[0];
const prefV = e => e.v[prefLang(e)];
const vk = (e, l) => vkey(l, e.v[l].id);
const ownedLangs = e => langsOf(e).filter(l => owned.has(vk(e, l)));
const wishLangs = e => langsOf(e).filter(l => wish.has(vk(e, l)));
const isOwned = e => ownedLangs(e).length > 0;
// Image de secours si une image japonaise/anglaise n'existe pas : la même carte dans une autre langue, sinon un dos de carte.
const fbOf = (e, lang, q = 'low') => { const l = LANGS.find(x => x !== lang && e.v[x] && (e.v[x].i || e.v[x].u)); return l ? imgOf(e.v[l], q) : 'icons/card-back.svg'; };
window.imgFail = img => { const fb = img.dataset.fb; img.onerror = null; img.src = fb && fb !== img.src ? fb : 'icons/card-back.svg'; };
const hasImg = v => !!(v.i || v.u);
const noImage = e => !langsOf(e).some(l => hasImg(e.v[l]));
const noImgTag = e => noImage(e) ? `<span class="noimg">${esc(e.n)}<small>image indisponible</small></span>` : '';
const imgAttrs = (e, lang, q = 'low') => `src="${hasImg(e.v[lang]) ? imgOf(e.v[lang], q) : fbOf(e, lang, q)}" data-fb="${esc(fbOf(e, lang, q))}" onerror="imgFail(this)"`;
const imgOf = (v, q = 'low') => v.u ? v.u[q === 'low' ? 0 : 1] : v.i ? `${v.i}/${q}.webp` : 'icons/card-back.svg';
// Le français et l'anglais partagent la même fiche Cardmarket (donc le même prix) : on ne la charge qu'une fois.
const pkey = (e, l) => (l === 'en' && e.v.fr) ? vk(e, 'fr') : vk(e, l);
const visible = e => !typeFilter || e.r === typeFilter;
const setInfo = sid => catalog?.sets[sid] || extraSets[sid];
const setName = sid => { const s = setInfo(sid); return s ? s.n : sid.replace(/^ja:/, ''); };
const setDate = sid => setInfo(sid)?.d || '';
const dexName = n => pokedex[n] || byDex.get(n)?.[0]?.n.replace(/\s+(ex|EX|V|VMAX|VSTAR)$/, '') || `Pokémon #${n}`;

// ---------- Réseau ----------
async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function pool(items, size, fn) {
  const q = items.slice();
  await Promise.all(Array.from({ length: Math.min(size, q.length) }, async () => { while (q.length) await fn(q.shift()); }));
}
const days = (a, b) => (a && b) ? Math.abs((Date.parse(a) - Date.parse(b)) / DAY) : 250;

async function fetchCatalog() {
  const gqlQuery = '{' + RARITIES.map((r, i) =>
    `r${i}: cards(filters:{rarity:${JSON.stringify(r.en)}}, pagination:{page:1,itemsPerPage:3000}) { id dexId illustrator image localId }`
  ).join(' ') + '}';
  const [frLists, gql, frSetsList, jaLists] = await Promise.all([
    Promise.all(RARITIES.map(r => getJSON(`${API}/fr/cards?rarity=${encodeURIComponent(r.fr)}`))),
    getJSON(`${API}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: gqlQuery }) }).catch(() => null),
    getJSON(`${API}/fr/sets`).catch(() => []),
    Promise.all(RARITIES.map(r => getJSON(`${API}/ja/cards?rarity=${encodeURIComponent(r.en)}`))).catch(() => null),
  ]);

  // Métadonnées anglaises (même identifiants que le français) : n° de Pokédex, illustrateur, image anglaise.
  const en = new Map();
  if (gql?.data) RARITIES.forEach((r, i) => { for (const c of gql.data[`r${i}`] || []) en.set(c.id, { ...c, r: r.code }); });   // « Illustration rare » inclut les SAR, la 2ᵉ requête les corrige

  const raw = [];
  frLists.forEach((list, i) => { for (const c of list) raw.push({ ...c, code: RARITIES[i].code }); });
  const unknown = raw.filter(c => !en.has(c.id));
  await pool(unknown, 6, async c => {                     // carte absente de GraphQL (retard de synchro)
    try { const d = await getJSON(`${API}/fr/cards/${c.id}`); en.set(c.id, { id: c.id, dexId: d.dexId || [], illustrator: d.illustrator || '', image: null, localId: c.localId, r: c.code }); } catch { /* retenté au prochain lancement */ }
  });

  const cards = [];
  const illus = new Map();                                // clé d'entrée -> illustrateur normalisé (sert à rapprocher les langues)
  const matchable = new Map();                            // clé (pokémon+illustrateur+type) -> entrées françaises
  for (const c of raw) {
    const m = en.get(c.id);
    if (!m || !m.dexId?.length || !c.image) continue;     // dresseurs & co : ignorés
    const s = c.id.slice(0, c.id.lastIndexOf('-'));
    const e = { k: c.id, d: m.dexId, n: c.name, r: c.code, v: { fr: { id: c.id, i: c.image, l: c.localId, s } } };
    if (m.image) e.v.en = { id: c.id, i: m.image, l: c.localId, s };
    cards.push(e); illus.set(e.k, norm(m.illustrator || ''));
    const key = `${[...m.dexId].sort().join('.')}|${norm(m.illustrator || '')}|${c.code}`;
    if (!matchable.has(key)) matchable.set(key, []);
    matchable.get(key).push(e);
  }
  const known = new Set(cards.map(c => c.k));
  for (const c of legacy) if (!known.has(c.id)) {
    const v = { id: c.id, l: c.l, s: c.s }; if (c.i) v.i = c.i; if (c.u) v.u = c.u;
    cards.push({ k: c.id, d: c.d, n: c.n, r: c.r, v: { fr: v } }); illus.set(c.id, norm(c.a || ''));
  }

  // Sets (français)
  const sets = { ...(catalog?.sets || {}) };
  const names = new Map(frSetsList.map(s => [s.id, s]));
  await pool([...new Set(cards.map(c => c.v.fr.s))], 6, async sid => {
    if (sets[sid]?.d) return;
    try {
      const s = await getJSON(`${API}/fr/sets/${sid}`);
      sets[sid] = { n: s.name, d: s.releaseDate || '' };
    } catch { sets[sid] = sets[sid] || { n: names.get(sid)?.name || sid, d: '' }; }
  });

  // Cartes japonaises : rapprochées des cartes françaises/anglaises par (Pokémon, illustrateur, type) puis par proximité de date.
  if (jaLists) {
    const sar = new Set(jaLists[1].map(c => c.id));
    const jl = new Map();
    for (const c of [...jaLists[0], ...jaLists[1]]) jl.set(c.id, c);
    const meta = id => jaMeta[id] || jaBase.meta[id];
    await pool([...jl.keys()].filter(id => !meta(id)), 6, async id => {
      try {
        const d = await getJSON(`${API}/ja/cards/${id}`);
        jaMeta[id] = [d.dexId || [], d.illustrator || '', d.localId, d.set.id, d.name, d.category === 'Pokemon' ? 'Pokemon' : 'T'];
      } catch { /* retenté au prochain lancement */ }
    });
    store.set('jaMeta', jaMeta);
    const ja = [];
    for (const [id, c] of jl) {
      const m = meta(id);
      if (!m || m[5] !== 'Pokemon' || !m[0].length) continue;
      // Image japonaise seulement si TCGdex la fournit : les adresses « devinées » tombent sur d'autres cartes. Sinon l'image française prend le relais.
      ja.push({ id, d: m[0], a: m[1], r: sar.has(id) ? 'SAR' : 'AR', l: c.localId, s: m[3], n: m[4], i: c.image || null });
    }
    await pool([...new Set(ja.map(j => j.s))], 6, async sid => {
      const key = 'ja:' + sid;
      if (sets[key]?.d) return;
      if (jaBase.sets[sid]?.d) { sets[key] = jaBase.sets[sid]; return; }
      try { const s = await getJSON(`${API}/ja/sets/${sid}`); sets[key] = { n: s.name, d: s.releaseDate || '' }; }
      catch { sets[key] = sets[key] || { n: sid, d: '' }; }
    });

    const used = new Set(), pairs = [];
    ja.sort((a, b) => (sets['ja:' + a.s]?.d || '').localeCompare(sets['ja:' + b.s]?.d || '') || a.id.localeCompare(b.id));
    for (const j of ja) {
      const key = `${[...j.d].sort().join('.')}|${norm(j.a)}|${j.r}`;
      const jd = sets['ja:' + j.s]?.d;
      const cand = (matchable.get(key) || []).filter(e => !used.has(e.k)).map(e => ({ e, gap: days(jd, sets[e.v.fr.s]?.d), loc: numOf(e.v.fr.l) !== numOf(j.l) }))
        .filter(x => x.gap <= 500).sort((a, b) => (a.gap > 150) - (b.gap > 150) || a.loc - b.loc || a.gap - b.gap);
      if (cand.length) { used.add(cand[0].e.k); pairs.push([j, cand[0].e]); } else pairs.push([j, null]);
    }
    // Un rapprochement vers une extension « minoritaire » pour ce set japonais est presque toujours un faux positif.
    const tally = new Map();
    for (const [j, e] of pairs) if (e) { const t = tally.get(j.s) || {}; t[e.v.fr.s] = (t[e.v.fr.s] || 0) + 1; tally.set(j.s, t); }
    const leftovers = [];
    for (const [j, e] of pairs) {
      const t = tally.get(j.s), total = t ? Object.values(t).reduce((x, y) => x + y, 0) : 0;
      if (e && t[e.v.fr.s] >= 0.2 * total) e.v.ja = jaVariant(j); else leftovers.push(j);
    }
    // 2ᵉ passe : une même illustration peut avoir un autre type côté français (ex. carte AR japonaise = promo française, AR japonaise = Galerie de Crown Zenith).
    // Même Pokémon + même illustrateur (à une faute de frappe près) = même carte : on rattache la version japonaise à la carte existante plutôt que de créer un doublon.
    const byDexKey = new Map();
    for (const e of cards) {
      if (!illus.get(e.k)) continue;
      const key = [...e.d].sort().join('.');
      if (!byDexKey.has(key)) byDexKey.set(key, []);
      byDexKey.get(key).push(e);
    }
    for (const j of leftovers) {
      const a = norm(j.a), jd = sets['ja:' + j.s]?.d;
      const cand = a ? (byDexKey.get([...j.d].sort().join('.')) || []).filter(e => e.v.fr && !e.v.ja && similar(illus.get(e.k), a))
        .map(e => ({ e, gap: days(jd, sets[e.v.fr.s]?.d) })).sort((x, y) => x.gap - y.gap) : [];
      if (cand.length) cand[0].e.v.ja = jaVariant(j);
      else if (j.i) {                                       // carte qui n'existe qu'en japonais : affichée seulement si on a son image
        const base = pokedex[j.d[0]];
        cards.push({ k: j.id, d: j.d, n: base ? base + (/ex$/i.test(j.n) ? '-ex' : '') : j.n, r: j.r, v: { ja: jaVariant(j) } });
      }
    }
  }
  return { v: CATALOG_VERSION, t: Date.now(), cards, sets };
}

function similar(a, b) {                                // illustrateurs identiques à 2 fautes de frappe près (les bases FR/EN et JP n'écrivent pas toujours pareil)
  if (a === b) return true;
  if (!a || !b || Math.min(a.length, b.length) < 6 || Math.abs(a.length - b.length) > 2) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let k = 1; k <= b.length; k++) cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + (a[i - 1] === b[k - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length] <= 2;
}
function jaVariant(j) { const v = { id: j.id, l: j.l, s: 'ja:' + j.s }; if (j.i) v.i = j.i; return v; }

// ---------- Index ----------
function toEntry(c) {                                  // anciennes cartes ajoutées à la main (format v1) -> entrée
  if (c.v) return c;
  const v = { id: c.id, l: c.l, s: c.s }; if (c.i) v.i = c.i; if (c.u) v.u = c.u;
  return { k: c.id, d: c.d, n: c.n, r: 'PERSO', sn: c.sn, v: { fr: v } };
}
function buildIndex() {
  custom = custom.map(toEntry);
  byDex = new Map(); byKey = new Map(); byVer = new Map(); bySet = new Map(); maxDex = MIN_DEX; extraSets = {};
  const inCat = new Set(catalog.cards.map(c => c.k));
  const all = catalog.cards.concat(custom.filter(c => !inCat.has(c.k)));
  for (const c of custom) { const s = c.v.fr.s; if (!catalog.sets[s]) extraSets[s] = { n: c.sn || s, d: '' }; }
  for (const e of all) {
    const pv = prefV(e); e.s = pv.s; e.l = pv.l;
    byKey.set(e.k, e);
    for (const l of langsOf(e)) byVer.set(vk(e, l), e);
    for (const d of e.d) { if (!byDex.has(d)) byDex.set(d, []); byDex.get(d).push(e); if (d > maxDex) maxDex = d; }
    if (!bySet.has(e.s)) bySet.set(e.s, []); bySet.get(e.s).push(e);
  }
  const cmp = (a, b) => (setDate(a.s) || '9999').localeCompare(setDate(b.s) || '9999') || a.s.localeCompare(b.s) || numOf(a.l) - numOf(b.l);
  for (const list of byDex.values()) list.sort(cmp);
  for (const list of bySet.values()) list.sort((a, b) => numOf(a.l) - numOf(b.l));
}

// ---------- Prix ----------
const inflight = new Map();
const failed = new Set();                      // prix qu'on n'a pas pu charger (réseau, limite de débit) : réessayés à la prochaine occasion
let saveTimer;
function savePrices() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set('prices', prices), 800); }

function ensurePrice(pk, force = false) {
  const p = prices[pk];
  if (!force && p && Date.now() - p.t < PRICE_TTL) return Promise.resolve(p);
  if (inflight.has(pk)) return inflight.get(pk);
  const [lang, ...rest] = pk.split(':'), id = rest.join(':');
  const job = limit(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {         // TCGdex limite parfois le débit : on réessaie quelques secondes plus tard
      try {
        const d = await getJSON(`${API}/${lang}/cards/${id}`);
        const cm = d.pricing?.cardmarket;
        prices[pk] = { t: Date.now(), tr: cm?.trend || cm?.avg || null, avg: cm?.avg ?? null, low: cm?.low ?? null, a1: cm?.avg1 ?? null, a7: cm?.avg7 ?? null, a30: cm?.avg30 ?? null, up: cm?.updated || null };
        failed.delete(pk); savePrices(); break;
      } catch { if (attempt === 2) failed.add(pk); else await new Promise(r => setTimeout(r, 1500 * (attempt + 1))); }
    }
    inflight.delete(pk);
    paintPrice(pk);
    return prices[pk];
  });
  inflight.set(pk, job);
  return job;
}
let active = 0; const waiting = [];
function limit(fn) {
  return new Promise((res, rej) => {
    const run = () => { active++; fn().then(res, rej).finally(() => { active--; waiting.shift()?.(); }); };
    active < 6 ? run() : waiting.push(run);
  });
}
const priceOf = pk => prices[pk]?.tr ?? null;
const pct = (now, before) => (now != null && before) ? (now / before - 1) * 100 : null;
function dltHTML(pk) {
  const p = prices[pk], c = pct(p?.tr, p?.a7);
  if (c == null || Math.abs(c) < 1) return `<span class="dlt" data-dk="${pk}"></span>`;
  return `<span class="dlt ${c > 0 ? 'up' : 'dn'}" data-dk="${pk}" title="Variation sur 7 jours">${c > 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(0)} %</span>`;
}
function priceHTML(pk) {
  const p = prices[pk], v = p?.tr != null ? eur(p.tr) : null;
  return `<span class="price${v ? '' : ' na'}" data-pk="${pk}">${v || (p ? '—' : failed.has(pk) ? '⟳' : '…')}</span>${dltHTML(pk)}`;
}
function paintPrice(pk) {
  const p = prices[pk], v = p?.tr != null ? eur(p.tr) : null;
  document.querySelectorAll(`[data-pk="${pk}"]`).forEach(el => { el.textContent = v || (p ? '—' : '⟳'); el.classList.toggle('na', !v); });
  const c = pct(p?.tr, p?.a7);
  document.querySelectorAll(`[data-dk="${pk}"]`).forEach(el => {
    if (c == null || Math.abs(c) < 1) { el.textContent = ''; el.className = 'dlt'; }
    else { el.textContent = `${c > 0 ? '▲' : '▼'} ${Math.abs(c).toFixed(0)} %`; el.className = `dlt ${c > 0 ? 'up' : 'dn'}`; }
  });
  if (tab === 'col' || tab === 'wish') paintTotal();
  if (!$('#viewer').hidden) paintViewer();
  if (!$('#stats').hidden) renderStats();
}
const watchPrices = (pks, force = false) => pks.forEach(pk => ensurePrice(pk, force));
const prefPk = e => pkey(e, prefLang(e));
const allPks = e => [...new Set(langsOf(e).map(l => pkey(e, l)))];

// ---------- Rendu : Pokédex ----------
const dexList = n => (byDex.get(n) || []).filter(visible);
const ownedCount = list => list.filter(isOwned).length;
const wishCount = list => list.filter(e => wishLangs(e).length).length;

function tileHTML(n) {
  const list = dexList(n), o = ownedCount(list), w = wishCount(list);
  const cls = ['tile', list.length ? 'has' : 'zero', list.length && o === list.length ? 'done' : ''].join(' ');
  return `<button class="${cls}" data-dex="${n}">
    <span class="num">${pad(n)}</span>${o ? `<span class="own">${o}/${list.length}</span>` : ''}${w ? `<span class="wsh">♥ ${w}</span>` : ''}
    <img src="${ARTWORK(n)}" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">
    <div class="nm">${esc(dexName(n))}</div>
    <div class="cnt">${plural(list.length, 'carte')}</div></button>`;
}
function renderDex() {
  $('#dexGrid').hidden = mode !== 'dex'; $('#setList').hidden = mode !== 'set';
  $('#filters').hidden = mode !== 'dex';
  if (mode === 'set') return renderSets();
  const q = norm(query.trim());
  const out = [];
  for (let n = 1; n <= maxDex; n++) {
    const list = dexList(n);
    if (filter === 'cards' && !list.length) continue;
    if (q && !(norm(dexName(n)).includes(q) || String(n) === q.replace(/^#?0*/, '') || pad(n).includes(q))) continue;
    out.push(tileHTML(n));
  }
  $('#dexGrid').innerHTML = out.join('') || '<div class="empty" style="grid-column:1/-1">Aucun Pokémon trouvé.</div>';
}
function refreshTile(n) { const el = $(`.tile[data-dex="${n}"]`); if (el) el.outerHTML = tileHTML(n); }

// ---------- Rendu : extensions ----------
function renderSets() {
  const q = norm(query.trim());
  const rows = [...bySet.entries()].map(([sid, list]) => [sid, list.filter(visible)]).filter(([, l]) => l.length)
    .filter(([sid]) => !q || norm(setName(sid)).includes(q))
    .sort((a, b) => (setDate(b[0]) || '').localeCompare(setDate(a[0]) || ''));
  $('#setList').innerHTML = rows.map(([sid, list]) => {
    const o = ownedCount(list);
    return `<button class="setrow" data-set="${esc(sid)}"><div class="sr-top"><b>${esc(setName(sid))}</b>${sid.startsWith('ja:') ? '<i class="lg">JP</i>' : ''}<span class="muted">${esc(setDate(sid))}</span></div>
      <div class="bar"><i style="width:${Math.round(100 * o / list.length)}%"></i></div><div class="muted">${o} / ${plural(list.length, 'carte')}</div></button>`;
  }).join('') || '<div class="empty">Aucune extension trouvée.</div>';
}

// ---------- Rendu : feuille (Pokémon ou extension) ----------
let sheetCtx = null;                 // { kind: 'dex'|'set', id }
let sheetSort = 'default';
function sheetEntries() {
  const base = sheetCtx.kind === 'dex' ? (byDex.get(sheetCtx.id) || []) : (bySet.get(sheetCtx.id) || []);
  const list = base.filter(visible);
  if (sheetSort === 'default') return list;
  const v = e => priceOf(prefPk(e));
  return [...list].sort((a, b) => ((v(a) ?? (sheetSort === 'desc' ? -1 : 1e9)) - (v(b) ?? (sheetSort === 'desc' ? -1 : 1e9))) * (sheetSort === 'desc' ? -1 : 1));
}
function langChips(e) {
  const ow = ownedLangs(e), wi = wishLangs(e);
  return `<span class="langs">${langsOf(e).map(l => `<i class="lg${ow.includes(l) ? ' own' : ''}${wi.includes(l) ? ' wi' : ''}">${LCODE[l]}</i>`).join('')}</span>`;
}
function pcardHTML(e) {
  const ow = ownedLangs(e), wi = wishLangs(e).length > 0, pv = prefV(e), pk = prefPk(e);
  return `<div class="pcard ${ow.length ? 'on' : 'off'}${wi ? ' wished' : ''}" data-k="${esc(e.k)}">
    <div class="img" data-open="${esc(e.k)}"><img ${imgAttrs(e, prefLang(e))} alt="${esc(e.n)}" loading="lazy">
      <span class="badge ${e.r}">${rar(e.r)}</span>${langChips(e)}${noImgTag(e)}</div>
    <div class="meta"><span class="set">${esc(setName(pv.s))} · n° ${esc(pv.l)}</span><span class="pl">${priceHTML(pk)}</span></div>
    <div class="acts"><button class="check" data-own-entry="${esc(e.k)}"><span class="box">✓</span><span>${ow.length ? `Dans ma collection · ${ow.map(l => LCODE[l]).join('/')}` : 'Ajouter à ma collection'}</span></button>
    <button class="wbtn" data-wish-entry="${esc(e.k)}" aria-label="Wish list" title="Wish list">♥</button></div>${e.r === 'PERSO' ? `<button class="mini" data-uncustom="${esc(e.k)}">Retirer de la liste</button>` : ''}</div>`;
}
function refreshPcard(e) { document.querySelectorAll(`.pcard[data-k="${CSS.escape(e.k)}"]`).forEach(el => el.outerHTML = pcardHTML(e)); }

async function renderSheet(keepScroll) {
  const list = sheetEntries();
  const scroll = $('#sheet .sheet-body').scrollTop;
  const empty = sheetCtx.kind === 'dex'
    ? '0 carte AR/SAR pour ce Pokémon.<br>Si une nouvelle extension en apporte une, elle apparaîtra ici automatiquement.' : 'Aucune carte.';
  $('#shCards').innerHTML = list.length ? list.map(pcardHTML).join('') : `<div class="empty" style="grid-column:1/-1">${empty}</div>`;
  paintSheetInfo();
  $('#sheet .sheet-body').scrollTop = keepScroll ? scroll : 0;
  watchPrices(list.flatMap(allPks));
}
function openSheet(ctx, replace) {
  sheetCtx = ctx; sheetSort = 'default'; $('#shSort').value = 'default';
  if (ctx.kind === 'dex') {
    $('#shArt').src = ARTWORK(ctx.id); $('#shArt').hidden = false;
    $('#shNum').textContent = `N° ${pad(ctx.id)}`; $('#shName').textContent = dexName(ctx.id);
  } else {
    $('#shArt').hidden = true; $('#shNum').textContent = setDate(ctx.id) || ''; $('#shName').textContent = setName(ctx.id);
  }
  $('#addCardBtn').hidden = ctx.kind !== 'dex';
  showModal('#sheet', replace);
  renderSheet(false);
}
function paintSheetInfo() {
  const list = sheetEntries();
  $('#shInfo').textContent = list.length ? `${plural(list.length, 'carte')} · ${ownedCount(list)} dans ma collection` : '';
}

// ---------- Rendu : collection et wish list (une ligne par variante) ----------
function renderList(kind) {
  const src = kind === 'wish' ? wish : owned;
  const groups = new Map();
  for (const key of src) {
    const e = byVer.get(key); if (!e) continue;
    const lang = key.slice(0, key.indexOf(':'));
    const dex = e.d[0];                                     // carte multi-Pokémon : rangée sous le plus petit n°
    if (!groups.has(dex)) groups.set(dex, []);
    groups.get(dex).push({ e, lang });
  }
  const order = (a, b) => (setDate(a.e.s) || '9999').localeCompare(setDate(b.e.s) || '9999') || numOf(a.e.l) - numOf(b.e.l) || LANGS.indexOf(a.lang) - LANGS.indexOf(b.lang);
  const rows = [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([dex, list]) => [dex, list.sort(order)]);
  $(kind === 'wish' ? '#wishList' : '#colList').innerHTML = rows.length ? rows.map(([dex, list]) => `
    <div class="col-group"><h3>#${pad(dex)} ${esc(dexName(dex))} <span>${plural(list.length, 'carte')}</span></h3>
      <div class="col-cards">${list.map(({ e, lang }) => `<button class="ccard" data-view="${esc(vkey(lang, e.v[lang].id))}"><div class="img"><img ${imgAttrs(e, lang)} alt="${esc(e.n)}" loading="lazy"><i class="lg badge-lg">${LCODE[lang]}</i>${noImgTag(e)}</div>${kind === 'wish' ? langPrices(e, lang) : `<span class="pl">${priceHTML(pkey(e, lang))}</span>`}</button>`).join('')}</div>
    </div>`).join('')
    : kind === 'wish'
      ? `<div class="empty">Ta wish list est vide.<br>Dans « Toutes les cartes », ouvre un Pokémon et touche ♥ sous la carte que tu cherches.</div>`
      : `<div class="empty">Ta collection est vide.<br>Va dans « Toutes les cartes », choisis un Pokémon et coche tes cartes.</div>`;
  collectionOrder[kind] = rows.flatMap(([, l]) => l.map(x => ({ k: x.e.k, lang: x.lang })));
  watchPrices(kind === 'wish' ? [...src].filter(k => byVer.has(k)).flatMap(k => allPks(byVer.get(k)))
    : [...src].filter(k => byVer.has(k)).map(k => { const e = byVer.get(k), l = k.slice(0, k.indexOf(':')); return pkey(e, l); }));
  paintTotal();
}
const collectionOrder = { col: [], wish: [] };
// Wish list : le prix de chaque langue disponible, la langue recherchée en surbrillance
const langPrices = (e, lang) => `<span class="lpx">${langsOf(e).map(l => { const p = prices[pkey(e, l)]?.tr; return `<span class="${l === lang ? 'cur' : ''}"><i class="lg">${LCODE[l]}</i><span class="price${p != null ? '' : ' na'}" data-pk="${pkey(e, l)}">${p != null ? eur(p) : failed.has(pkey(e, l)) ? '⟳' : '…'}</span></span>`; }).join('')}</span>`;
const renderCollection = () => renderList('col');
const renderWish = () => renderList('wish');

function totals(set) {
  let sum = 0, a7 = 0, known = 0, n = 0;
  for (const key of set) {
    const e = byVer.get(key); if (!e) continue;
    n++;
    const p = prices[pkey(e, key.slice(0, key.indexOf(':')))];
    if (p?.tr != null) { sum += p.tr; known++; a7 += p.a7 ?? p.tr; }
  }
  return { n, sum, known, pending: n - known, delta: sum - a7, pct: a7 ? (sum / a7 - 1) * 100 : 0 };
}
function paintTotal() {
  const t = totals(tab === 'wish' ? wish : owned);
  const d = Math.abs(t.pct) >= 0.5 && tab !== 'wish' ? ` <span class="dlt ${t.delta > 0 ? 'up' : 'dn'}" title="Variation sur 7 jours">${t.delta > 0 ? '▲ +' : '▼ −'}${eur(Math.abs(t.delta))} (${t.pct > 0 ? '+' : '−'}${Math.abs(t.pct).toFixed(1)} %) /7 j</span>` : '';
  $('#sumInfo').innerHTML = `<span><b>${t.n}</b> carte${t.n > 1 ? 's' : ''}</span>
    <span class="total">${tab === 'wish' ? 'À prévoir' : 'Valeur'} : <b>${eur(t.sum)}</b>${t.pending ? ` <small>(${t.pending} prix en attente)</small>` : ''}${d}</span>`;
}

// ---------- Visionneuse ----------
let viewer = { list: [], idx: 0, k: null, lang: null };
function openViewer(k, lang, list) {
  const e = byKey.get(k); if (!e) return;
  const l = lang && e.v[lang] ? lang : prefLang(e);
  viewer.list = list || [{ k, lang: l }];
  viewer.idx = viewer.list.findIndex(x => x.k === k && x.lang === l);
  if (viewer.idx < 0) { viewer.list = [{ k, lang: l }]; viewer.idx = 0; }
  setViewer(k, l);
  if ($('#viewer').hidden) showModal('#viewer');
}
function setViewer(k, lang) { viewer.k = k; viewer.lang = lang; paintViewer(true); watchPrices(allPks(byKey.get(k))); }
function stepViewer(d) {
  const i = viewer.idx + d; if (i < 0 || i >= viewer.list.length) return;
  viewer.idx = i; setViewer(viewer.list[i].k, viewer.list[i].lang);
}
function paintViewer(full) {
  const e = byKey.get(viewer.k); if (!e) return;
  const v = e.v[viewer.lang];
  if (full) {
    const im = $('#vImg'); im.dataset.fb = fbOf(e, viewer.lang, 'high'); im.onerror = () => window.imgFail(im); im.src = hasImg(v) ? imgOf(v, 'high') : fbOf(e, viewer.lang, 'high');
    $('#vInfo').innerHTML = `<h2>${esc(e.n)} <span class="badge-inline ${e.r}">${rar(e.r)}</span></h2><div class="muted">${esc(setName(v.s))} · n° ${esc(v.l)}</div>${hasImg(v) ? '' : `<div class="muted tiny">Image ${LNAME[viewer.lang].toLowerCase()} indisponible : illustration d’une autre langue affichée.</div>`}`;
    $('#vPrev').hidden = viewer.idx <= 0; $('#vNext').hidden = viewer.idx >= viewer.list.length - 1;
    $('#vPos').textContent = viewer.list.length > 1 ? `${viewer.idx + 1} / ${viewer.list.length}` : '';
  }
  renderLangRows(e, $('#vLangs'), true);
  const p = prices[pkey(e, viewer.lang)];
  const d = p?.up ? new Date(p.up).toLocaleDateString('fr-FR') : null;
  const c7 = pct(p?.tr, p?.a7), c30 = pct(p?.tr, p?.a30);
  const f = c => c == null ? '—' : `<span class="${c > 0.5 ? 'up' : c < -0.5 ? 'dn' : ''}">${c > 0 ? '+' : c < 0 ? '−' : ''}${Math.abs(c).toFixed(1)} %</span>`;
  $('#vPrice').innerHTML = !p ? '<div class="muted">Chargement du prix…</div>' : p.tr == null ? '<div class="muted">Pas de prix disponible</div>'
    : `<div class="big">${eur(p.tr)} <small>${LNAME[viewer.lang]}</small></div><div class="muted">Cote Cardmarket (tendance)${p.avg != null ? ` · moy. ${eur(p.avg)}` : ''}${p.low != null ? ` · dès ${eur(p.low)}` : ''}<br>7 j : ${f(c7)} · 30 j : ${f(c30)}${d ? `<br>mis à jour le ${d}` : ''}</div>`;
}
// Lignes « une par langue » : prix, ajout à la collection, wish list. Utilisées par la visionneuse et le sélecteur de langue.
function renderLangRows(e, el, selectable) {
  const ls = langsOf(e);
  el.innerHTML = ls.map(l => {
    const key = vk(e, l), pk = pkey(e, l), ow = owned.has(key), wi = wish.has(key);
    return `<div class="lrow${selectable && viewer.lang === l ? ' sel' : ''}${ow ? ' on' : ''}" data-k="${esc(e.k)}">
      <button class="lname" ${selectable ? `data-vlang="${l}"` : ''}><i class="lg">${LCODE[l]}</i> ${LNAME[l]}</button>
      <span class="lp">${priceHTML(pk)}</span>
      <button class="lbtn${ow ? ' on' : ''}" data-own-ver="${esc(key)}" title="Collection">${ow ? '✓ Possédée' : '＋ Collection'}</button>
      <button class="lbtn w${wi ? ' on' : ''}" data-wish-ver="${esc(key)}" title="Wish list" aria-label="Wish list">${wi ? '♥' : '♡'}</button></div>`;
  }).join('') + (ls.includes('fr') && ls.includes('en') ? '<div class="muted tiny">Français et anglais partagent la même cote Cardmarket.</div>' : '');
}
function openLangPick(e) {
  $('#lpTitle').textContent = e.n; $('#lpSub').textContent = 'Quelle version possèdes-tu ?';
  langPickKey = e.k; renderLangRows(e, $('#lpRows'), false);
  showModal('#langPick'); watchPrices(allPks(e));
}
let langPickKey = null;

// ---------- Actions ----------
function touched() {                                      // sauvegarde + suivi du dernier export
  store.set('owned', [...owned]); store.set('wish', [...wish]);
  if (!backup.n) backup.since = Date.now();
  backup.n++; store.set('backup', backup); paintBackup();
}
function updateCounts() {
  $('#colCount').textContent = [...owned].filter(k => byVer.has(k)).length;
  $('#wishCount').textContent = [...wish].filter(k => byVer.has(k)).length;
}
function afterChange(e) {
  touched(); updateCounts();
  e.d.forEach(refreshTile);
  refreshPcard(e);
  if (!$('#sheet').hidden) paintSheetInfo();
  if (!$('#viewer').hidden && viewer.k === e.k) paintViewer();
  if (!$('#langPick').hidden && langPickKey === e.k) renderLangRows(e, $('#lpRows'), false);
  if (tab === 'col') renderCollection();
  if (tab === 'wish') renderWish();
  if (tab === 'dex' && mode === 'set') renderSets();
  if (!$('#stats').hidden) renderStats();
}
function toggleOwn(key) {                                 // une variante qui entre en collection sort de la wish list
  const e = byVer.get(key); if (!e) return;
  if (owned.has(key)) owned.delete(key); else { owned.add(key); if (wish.delete(key)) toast('Carte passée de la wish list à ta collection ✔'); }
  afterChange(e);
}
function toggleWishVer(key) {
  const e = byVer.get(key); if (!e) return;
  if (wish.has(key)) wish.delete(key);
  else {
    if (owned.has(key)) {
      if (!confirm('Cette version est dans ta collection. La déplacer dans la wish list ?')) return;
      owned.delete(key);
    }
    wish.add(key);
  }
  afterChange(e);
}
function ownEntry(e) {                                    // bouton « collection » d'une carte : direct si une seule langue, sinon on demande laquelle
  const ls = langsOf(e);
  if (ls.length === 1) return toggleOwn(vk(e, ls[0]));
  openLangPick(e);
}
function wishEntry(e) {                                   // bouton ♥ : version préférée (français d'abord), ou retrait si déjà en wish list
  const w = wishLangs(e);
  if (w.length) return w.forEach(l => { wish.delete(vk(e, l)); }), afterChange(e);
  toggleWishVer(vk(e, prefLang(e)));
}

function setTab(t) {
  tab = t;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#viewDex').hidden = t !== 'dex'; $('#viewCol').hidden = t !== 'col'; $('#viewWish').hidden = t !== 'wish';
  $('#dexTools').hidden = t !== 'dex'; $('#summary').hidden = t === 'dex';
  $('#statsBtn').hidden = t !== 'col'; $('#shareBtn').hidden = t !== 'wish';
  $('#title').textContent = { dex: 'Tous les Pokémon', col: 'Ma collection', wish: 'Ma wish list' }[t];
  if (t === 'col') renderCollection();
  if (t === 'wish') renderWish();
  window.scrollTo(0, 0);
}

// ---------- Statistiques ----------
function renderStats() {
  const all = [...byKey.values()];
  const mineE = all.filter(isOwned);
  const t = totals(owned);
  const bar = (o, n) => `<div class="bar"><i style="width:${n ? Math.round(100 * o / n) : 0}%"></i></div>`;
  const types = Object.keys(TYPES).map(r => [r, all.filter(e => e.r === r)]).filter(([, l]) => l.length);
  const sets = [...bySet.entries()].sort((a, b) => (setDate(b[0]) || '').localeCompare(setDate(a[0]) || ''));
  const byLang = LANGS.map(l => [l, [...owned].filter(k => byVer.has(k) && k.startsWith(l + ':')).length]);
  const top = [...owned].filter(k => byVer.has(k)).map(k => { const e = byVer.get(k), l = k.slice(0, k.indexOf(':')); return { e, l, p: priceOf(pkey(e, l)) }; })
    .filter(x => x.p != null).sort((a, b) => b.p - a.p).slice(0, 10);
  const dexOwned = new Set(mineE.flatMap(e => e.d)).size;
  $('#stBody').innerHTML = `
    <div class="st-cards"><div><b>${t.n}</b><span>cartes</span></div><div><b>${eur(t.sum)}</b><span>valeur</span></div>
      <div><b class="${t.delta > 0 ? 'up' : t.delta < 0 ? 'dn' : ''}">${t.delta >= 0 ? '+' : '−'}${eur(Math.abs(t.delta))}</b><span>sur 7 jours</span></div><div><b>${dexOwned}</b><span>Pokémon différents</span></div></div>
    ${t.pending ? `<p class="muted tiny">${t.pending} prix encore en chargement.</p>` : ''}
    <h3>Progression globale</h3><div class="muted">${mineE.length} / ${all.length} cartes · ${all.length ? Math.round(100 * mineE.length / all.length) : 0} %</div>${bar(mineE.length, all.length)}
    <h3>Par type</h3>${types.map(([r, l]) => `<div class="st-row"><span><i class="badge-inline ${r}">${rar(r)}</i></span><span class="muted">${ownedCount(l)} / ${l.length}</span></div>${bar(ownedCount(l), l.length)}`).join('')}
    <h3>Langues</h3><div class="muted">${byLang.map(([l, n]) => `${LNAME[l]} : ${n}`).join(' · ')}</div>
    <h3>Les plus chères</h3>${top.length ? top.map(x => `<button class="st-top" data-view="${esc(vkey(x.l, x.e.v[x.l].id))}"><img ${imgAttrs(x.e, x.l)} alt=""><span>${esc(x.e.n)} <i class="lg">${LCODE[x.l]}</i><br><small class="muted">${esc(setName(x.e.v[x.l].s))}</small></span><b>${eur(x.p)}</b></button>`).join('') : '<div class="muted">Aucune carte avec un prix pour l’instant.</div>'}
    <h3>Par extension</h3>${sets.map(([sid, l]) => `<button class="st-set" data-set="${esc(sid)}"><div class="st-row"><span>${esc(setName(sid))}${sid.startsWith('ja:') ? ' <i class="lg">JP</i>' : ''}</span><span class="muted">${ownedCount(l)} / ${l.length}</span></div>${bar(ownedCount(l), l.length)}</button>`).join('')}`;
}

// ---------- Sauvegarde (rappel) et partage ----------
function backupDue() {
  const items = owned.size + wish.size;
  if (!items || !backup.n || Date.now() < (backup.snooze || 0)) return false;
  return backup.n >= 20 || Date.now() - (backup.last || backup.since || Date.now()) > 30 * DAY;
}
function paintBackup() {
  $('#backupBar').hidden = !backupDue();
  $('#lastBackup').textContent = backup.last ? `Dernière sauvegarde : ${new Date(backup.last).toLocaleDateString('fr-FR')}` : 'Aucune sauvegarde faite pour l’instant.';
}
async function exportCollection() {
  const data = JSON.stringify({ app: 'vitrine-ar-sar', v: 2, date: new Date().toISOString(), owned: [...owned], wish: [...wish], custom }, null, 1);
  const file = new File([data], 'ma-collection-pokemon.json', { type: 'application/json' });
  let done = false;
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Ma collection' }); done = true; }
  } catch (e) { if (e.name === 'AbortError') return; }
  if (!done) { const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }
  backup = { last: Date.now(), since: 0, n: 0, snooze: 0 }; store.set('backup', backup); paintBackup();
}
async function importCollection(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.owned)) throw new Error();
    const before = owned.size + wish.size;
    migrate(d.owned).forEach(k => { owned.add(k); wish.delete(k); });
    migrate(d.wish).forEach(k => { if (!owned.has(k)) wish.add(k); });
    if (Array.isArray(d.custom)) for (const c of d.custom.map(toEntry)) if (!custom.some(o => o.k === c.k)) custom.push(c);
    store.set('custom', custom); store.set('owned', [...owned]); store.set('wish', [...wish]);
    buildIndex(); updateCounts(); renderDex();
    if (tab === 'col') renderCollection(); if (tab === 'wish') renderWish();
    toast(`${owned.size + wish.size - before} carte(s) ajoutée(s)`);
  } catch { toast('Fichier non valide'); }
}
async function shareWish() {
  const keys = [...wish].filter(k => byVer.has(k));
  if (!keys.length) return toast('Ta wish list est vide');
  const lines = keys.map(k => { const e = byVer.get(k), l = k.slice(0, k.indexOf(':')), p = priceOf(pkey(e, l)); return `• ${e.n} — ${setName(e.v[l].s)} n° ${e.v[l].l} (${LNAME[l]})${p != null ? ` ~ ${eur(p)}` : ''}`; });
  const url = `${location.origin}${location.pathname}#w=${btoa(unescape(encodeURIComponent(JSON.stringify(keys)))).replace(/=+$/, '')}`;
  const text = `Ma wish list Pokémon (cartes AR/SAR) :\n${lines.join('\n')}\n`;
  try { if (navigator.share) { await navigator.share({ title: 'Ma wish list Pokémon', text, url }); return; } } catch (e) { if (e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(`${text}\n${url}`); toast('Wish list copiée dans le presse-papiers'); } catch { prompt('Copie ce message :', `${text}\n${url}`); }
}
function openShared() {
  const m = location.hash.match(/^#w=(.+)$/); if (!m) return;
  try {
    const keys = JSON.parse(decodeURIComponent(escape(atob(m[1])))).filter(k => byVer.has(k));
    history.replaceState(null, '', location.pathname);
    if (!keys.length) return;
    sharedKeys = keys;
    $('#shBody').innerHTML = `<div class="col-cards">${keys.map(k => { const e = byVer.get(k), l = k.slice(0, k.indexOf(':')); return `<button class="ccard" data-view="${esc(k)}"><div class="img"><img ${imgAttrs(e, l)} alt="${esc(e.n)}" loading="lazy"><i class="lg badge-lg">${LCODE[l]}</i></div><span class="pl">${priceHTML(pkey(e, l))}</span></button>`; }).join('')}</div>`;
    watchPrices(keys.map(k => pkey(byVer.get(k), k.slice(0, k.indexOf(':')))));
    showModal('#shared');
  } catch { /* lien invalide : ignoré */ }
}
let sharedKeys = [];

// ---------- Fenêtres (avec bouton retour du téléphone) ----------
const stack = [];
function showModal(sel, replace) { lockScroll(); $(sel).hidden = false; stack.push(sel); replace ? history.replaceState({ m: sel }, '') : history.pushState({ m: sel }, ''); }
// Quand une fenêtre est ouverte, la page en arrière-plan ne doit pas défiler (sur iPhone, `overflow: hidden` ne suffit pas : on fige le body et on retient la position).
let lockY = null;
function lockScroll() {
  if (lockY !== null) return;
  lockY = window.scrollY;
  Object.assign(document.body.style, { position: 'fixed', top: `-${lockY}px`, left: '0', right: '0', width: '100%' });
}
function unlockScroll() {
  if (lockY === null) return;
  Object.assign(document.body.style, { position: '', top: '', left: '', right: '', width: '' });
  window.scrollTo(0, lockY); lockY = null;
}
let skipPop = 0;                                    // retours d'historique déclenchés par nous (ne doivent pas fermer une 2ᵉ fenêtre)
function hideTop(fromPop) {
  const sel = stack.pop(); if (!sel) return;
  $(sel).hidden = true;
  if (!stack.length) unlockScroll();
  if (!fromPop) { skipPop++; history.back(); }
}
window.addEventListener('popstate', () => {
  if (skipPop > 0) { skipPop--; return; }
  if (stack.length) hideTop(true);                  // bouton retour du téléphone : ferme seulement la fenêtre du dessus
});

let toastTimer;
function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms);
}

// ---------- Chargement ----------
function applyCatalog(newCat, announce) {
  const oldKeys = new Set((catalog?.cards || []).map(c => c.k));
  const fresh = newCat.cards.filter(c => !oldKeys.has(c.k));
  catalog = newCat; store.set('catalog', catalog);
  buildIndex(); renderDex(); updateCounts(); paintMenuInfo();
  if (tab === 'col') renderCollection();
  if (tab === 'wish') renderWish();
  if (sheetCtx && !$('#sheet').hidden) renderSheet(true);
  if (announce && fresh.length) {
    const sets = [...new Set(fresh.map(c => setName(c.s)))];
    toast(`🆕 ${fresh.length} nouvelle${fresh.length > 1 ? 's' : ''} carte${fresh.length > 1 ? 's' : ''} : ${sets.slice(0, 3).join(', ')}`, 7000);
  }
}
function paintMenuInfo() {
  if (!catalog) return;
  const n = (l) => catalog.cards.filter(c => c.v[l]).length;
  $('#menuInfo').textContent = `${catalog.cards.length} cartes (FR ${n('fr')} · JP ${n('ja')} · EN ${n('en')}) · catalogue du ${new Date(catalog.t).toLocaleString('fr-FR')}`;
}
let loadingCatalog = false;
async function refreshCatalog({ force = false, announce = true } = {}) {
  if (loadingCatalog) return;
  if (!force && catalog && Date.now() - catalog.t < CATALOG_MAX_AGE) return;
  loadingCatalog = true;
  try { applyCatalog(await fetchCatalog(), announce && !!catalog); }
  catch (e) {
    console.warn(e);
    if (!catalog) $('#loading').innerHTML = 'Impossible de charger le catalogue.<br><br><button class="btn" id="retry">Réessayer</button>';
    else if (force) toast('Hors ligne — catalogue en cache utilisé');
  } finally { loadingCatalog = false; if (catalog) $('#loading').hidden = true; }
}
function currentPriceKeys() {
  const ks = new Set();
  if (tab === 'col' || tab === 'wish') (tab === 'wish' ? wish : owned).forEach(k => { const e = byVer.get(k); if (e) ks.add(pkey(e, k.slice(0, k.indexOf(':')))); });
  if (!$('#sheet').hidden && sheetCtx) sheetEntries().forEach(e => allPks(e).forEach(p => ks.add(p)));
  return [...ks];
}

// ---------- Ajout manuel d'une carte ----------
let pickerDex = null, pickerCards = [], frSets = null;
const pickerCache = new Map();
async function openPicker(dex) {
  pickerDex = dex;
  $('#pkTitle').textContent = `Ajouter une carte — ${dexName(dex)}`;
  $('#pkSearch').value = '';
  $('#pkList').innerHTML = '<div class="empty">Chargement…</div>';
  showModal('#picker');
  try {
    if (!pickerCache.has(dex)) {
      const q = `{ cards(filters:{dexId:${dex}}, pagination:{page:1,itemsPerPage:600}) { id image rarity localId set{id name} } }`;
      const r = await getJSON(`${API}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q }) });
      pickerCache.set(dex, r.data.cards);
    }
    if (!frSets) frSets = new Map((await getJSON(`${API}/fr/sets`).catch(() => [])).map(x => [x.id, x.name]));
    pickerCards = pickerCache.get(dex);
    renderPicker();
  } catch { $('#pkList').innerHTML = '<div class="empty">Impossible de charger la liste (hors ligne ?).</div>'; }
}
function renderPicker() {
  const q = norm($('#pkSearch').value.trim());
  const sn = c => catalog.sets[c.set.id]?.n || frSets?.get(c.set.id) || c.set.name;
  const rows = pickerCards.filter(c => !byVer.has(vkey('fr', c.id)) && (!q || norm(`${sn(c)} ${c.localId} ${c.rarity || ''}`).includes(q)))
    .sort((a, b) => sn(a).localeCompare(sn(b)) || numOf(a.localId) - numOf(b.localId));
  $('#pkList').innerHTML = rows.map(c => {
    const fr = c.image ? c.image.replace('/en/', '/fr/') : '';
    return `<div class="pk-item"><img src="${fr ? fr + '/low.webp' : 'icons/card-back.svg'}" ${c.image ? `data-alt="${esc(c.image)}/low.webp"` : ''} loading="lazy" alt="" onerror="if(this.dataset.alt){this.src=this.dataset.alt;this.dataset.alt=''}else{this.onerror=null;this.src='icons/card-back.svg'}">
      <div class="pk-meta"><b>${esc(sn(c))}</b><span class="muted">n° ${esc(c.localId)} · ${esc(c.rarity || '—')}</span></div>
      <button class="btn" data-pick="${esc(c.id)}">Ajouter</button></div>`;
  }).join('') || '<div class="empty">Aucune autre carte trouvée.</div>';
}
async function addCustom(id, btn) {
  btn.disabled = true; btn.textContent = '…';
  try {
    let d; try { d = await getJSON(`${API}/fr/cards/${id}`); } catch { d = await getJSON(`${API}/en/cards/${id}`); }
    const tp = d.variants_detailed?.map(v => v.thirdParty?.tcgplayer).find(Boolean);
    const v = { id: d.id, l: String(d.localId), s: d.set.id };
    if (d.image) v.i = d.image;
    else if (tp) v.u = [`https://tcgplayer-cdn.tcgplayer.com/product/${tp}_200w.jpg`, `https://tcgplayer-cdn.tcgplayer.com/product/${tp}_400w.jpg`];
    const entry = { k: d.id, d: d.dexId?.length ? d.dexId : [pickerDex], n: d.name, sn: d.set.name, r: 'PERSO', v: { fr: v } };
    custom.push(entry); store.set('custom', custom);
    buildIndex(); renderDex();
    if (sheetCtx) renderSheet(true);
    renderPicker();
    toast(`${entry.n} ajoutée à la liste de ${dexName(pickerDex)}`);
  } catch { btn.disabled = false; btn.textContent = 'Réessayer'; toast('Échec — vérifie ta connexion'); }
}
function removeCustom(k) {
  custom = custom.filter(c => c.k !== k); store.set('custom', custom);
  for (const key of [...owned, ...wish]) if (key.endsWith(':' + k)) { owned.delete(key); wish.delete(key); }
  store.set('owned', [...owned]); store.set('wish', [...wish]);
  buildIndex(); renderDex(); updateCounts();
  if (sheetCtx) renderSheet(true);
  if (tab === 'col') renderCollection();
  if (tab === 'wish') renderWish();
}

// ---------- Événements ----------
document.addEventListener('click', e => {
  const t = e.target;
  const rp = t.closest('[data-pk]'); if (rp && rp.textContent === '⟳') { rp.textContent = '…'; ensurePrice(rp.dataset.pk, true); return; }
  if (t.closest('[data-close]')) return hideTop();
  const pk = t.closest('[data-pick]'); if (pk) return addCustom(pk.dataset.pick, pk);
  const uc = t.closest('[data-uncustom]'); if (uc) return removeCustom(uc.dataset.uncustom);
  if (t.closest('#addCardBtn')) return openPicker(sheetCtx.id);
  const tile = t.closest('[data-dex]'); if (tile) return openSheet({ kind: 'dex', id: +tile.dataset.dex });
  const st = t.closest('[data-set]'); if (st) {
    const fromStats = !$('#stats').hidden;
    if (fromStats) { $('#stats').hidden = true; stack.pop(); }     // remplace la fenêtre au lieu d'empiler (évite un retour d'historique parasite)
    return openSheet({ kind: 'set', id: st.dataset.set }, fromStats);
  }
  const op = t.closest('[data-open]'); if (op) {        // clic sur l'image : visionneuse, avec navigation dans la liste affichée
    const list = (sheetCtx ? sheetEntries() : []).map(x => ({ k: x.k, lang: prefLang(x) }));
    return openViewer(op.dataset.open, null, list);
  }
  const oe = t.closest('[data-own-entry]'); if (oe) return ownEntry(byKey.get(oe.dataset.ownEntry));
  const we = t.closest('[data-wish-entry]'); if (we) return wishEntry(byKey.get(we.dataset.wishEntry));
  const ov = t.closest('[data-own-ver]'); if (ov) return toggleOwn(ov.dataset.ownVer);
  const wv = t.closest('[data-wish-ver]'); if (wv) return toggleWishVer(wv.dataset.wishVer);
  const vl = t.closest('[data-vlang]'); if (vl) { setViewer(viewer.k, vl.dataset.vlang); return; }
  const v = t.closest('[data-view]'); if (v) {
    const key = v.dataset.view, ent = byVer.get(key), lang = key.slice(0, key.indexOf(':'));
    const ctx = v.closest('#viewCol') ? collectionOrder.col : v.closest('#viewWish') ? collectionOrder.wish : v.closest('#shared') ? sharedKeys.map(k => ({ k: byVer.get(k).k, lang: k.slice(0, k.indexOf(':')) })) : null;
    return openViewer(ent.k, lang, ctx);
  }
  if (t.closest('#vPrev')) return stepViewer(-1);
  if (t.closest('#vNext')) return stepViewer(1);
  const tb = t.closest('.tab'); if (tb) return setTab(tb.dataset.tab);
  const md = t.closest('[data-mode]'); if (md) {
    mode = md.dataset.mode; document.querySelectorAll('[data-mode]').forEach(c => c.classList.toggle('on', c === md));
    $('#search').placeholder = mode === 'dex' ? 'Nom ou numéro…' : 'Nom de l’extension…';
    return renderDex();
  }
  const ty = t.closest('[data-type]'); if (ty) {
    typeFilter = ty.dataset.type; document.querySelectorAll('[data-type]').forEach(c => c.classList.toggle('on', c === ty));
    renderDex(); if (tab === 'col') renderCollection(); if (!$('#sheet').hidden) renderSheet(true);
    return;
  }
  const ch = t.closest('[data-f]'); if (ch) {
    filter = ch.dataset.f;
    document.querySelectorAll('[data-f]').forEach(c => c.classList.toggle('on', c === ch));
    return renderDex();
  }
  if (t.closest('#menuBtn')) return showModal('#menu');
  if (t.closest('#statsBtn')) { renderStats(); watchPrices([...owned].filter(k => byVer.has(k)).map(k => pkey(byVer.get(k), k.slice(0, k.indexOf(':'))))); return showModal('#stats'); }
  if (t.closest('#shareBtn')) return shareWish();
  if (t.closest('#sharedAll')) {
    let n = 0; for (const k of sharedKeys) if (!owned.has(k) && !wish.has(k)) { wish.add(k); n++; }
    touched(); updateCounts(); renderDex(); hideTop(); setTab('wish'); return toast(`${n} carte(s) ajoutée(s) à ta wish list`);
  }
  if (t.closest('#retry')) { $('#loading').textContent = 'Chargement du catalogue…'; return refreshCatalog({ force: true }); }
  if (t.closest('#refreshBtn')) {
    hideTop(); toast('Actualisation…', 2000);
    return refreshCatalog({ force: true }).then(() => { watchPrices(currentPriceKeys(), true); if (tab === 'dex') toast('Catalogue à jour ✔'); });
  }
  if (t.closest('#exportBtn') || t.closest('#backupNow')) return exportCollection();
  if (t.closest('#backupLater')) { backup.snooze = Date.now() + 7 * DAY; store.set('backup', backup); return paintBackup(); }
  if (t.closest('#importBtn')) return $('#importFile').click();
});
$('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importCollection(f); e.target.value = ''; });
$('#pkSearch').addEventListener('input', renderPicker);
$('#search').addEventListener('input', e => { query = e.target.value; renderDex(); });
$('#shSort').addEventListener('change', async e => {
  sheetSort = e.target.value;
  if (sheetSort !== 'default') await Promise.all(sheetEntries().flatMap(allPks).map(pk => ensurePrice(pk)));
  renderSheet(false);
});
// Glisser le doigt sur la carte : précédente / suivante
(() => {
  let x0 = null;
  const img = $('#vImg');
  img.addEventListener('touchstart', e => { x0 = e.touches[0].clientX; }, { passive: true });
  img.addEventListener('touchend', e => {
    if (x0 == null) return;
    const dx = e.changedTouches[0].clientX - x0; x0 = null;
    if (Math.abs(dx) > 50) stepViewer(dx < 0 ? 1 : -1);
  });
})();

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (Date.now() - hiddenAt > CATALOG_MAX_AGE) refreshCatalog().then(() => watchPrices(currentPriceKeys()));
});

// ---------- Démarrage ----------
(async function init() {
  try { pokedex = await getJSON(`data/pokedex.json?v=${DATA_V}`); } catch { pokedex = {}; }
  try { legacy = (await Promise.all(['legacy-alt', 'legacy-gallery', 'legacy-promo', 'legacy-scenes'].map(f => getJSON(`data/${f}.json?v=${DATA_V}`)))).flat(); } catch { legacy = []; }
  try { jaBase = await getJSON(`data/ja-meta.json?v=${DATA_V}`); } catch { /* sans la base japonaise embarquée : détails récupérés un par un */ }
  if (catalog) { buildIndex(); renderDex(); $('#loading').hidden = true; updateCounts(); paintMenuInfo(); openShared(); }
  paintBackup();
  await refreshCatalog({ announce: true });
  if (!byKey.size) return;
  openShared();
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
