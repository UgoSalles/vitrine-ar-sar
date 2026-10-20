// Vitrine AR/SAR — collection de cartes Pokémon « Illustration rare » et « Illustration spéciale rare ».
// Données : TCGdex (cartes FR + prix Cardmarket), noms FR du Pokédex : data/pokedex.json, illustrations : PokéAPI.

const API = 'https://api.tcgdex.net/v2';
const RARITIES = [
  { fr: 'Illustration rare', en: 'Illustration rare', code: 'AR' },
  { fr: 'Illustration spéciale rare', en: 'Special illustration rare', code: 'SAR' },
];
const ARTWORK = n => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${n}.png`;
const MIN_DEX = 1025;
const CATALOG_MAX_AGE = 10 * 60 * 1000;   // pas de re-téléchargement du catalogue en dessous de 10 min
const PRICE_TTL = 30 * 60 * 1000;         // un prix est considéré frais 30 min

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const eur = n => n == null ? null : n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
const LABEL = { SCN: 'SCÈNE' };
const rar = r => LABEL[r] || r;
const pad = n => String(n).padStart(3, '0');

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota / mode privé */ } },
};

// ---------- État ----------
let pokedex = {};                       // { "25": "Pikachu" }
let custom = store.get('custom', []);   // cartes ajoutées à la main par l'utilisateur (propres à cet appareil)
let extraSets = {};
let legacy = [];                        // alt arts + galeries d'avant Écarlate et Violet (listes fixes : data/legacy-*.json)
let catalog = store.get('catalog', null); // { t, cards: [...], sets: {...} }
let owned = new Set(store.get('owned', []));
let prices = store.get('prices', {});   // { id: { t, tr, avg, low, up } }
let byDex = new Map();                  // dex -> cartes triées
let byId = new Map();
let maxDex = MIN_DEX;
let filter = 'all';
let query = '';
let tab = 'dex';

// ---------- Réseau ----------
async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function fetchCatalog() {
  const gqlQuery = '{' + RARITIES.map((r, i) =>
    `r${i}: cards(filters:{rarity:${JSON.stringify(r.en)}}, pagination:{page:1,itemsPerPage:3000}) { id dexId }`
  ).join(' ') + '}';
  const [lists, gql, allSets] = await Promise.all([
    Promise.all(RARITIES.map(r => getJSON(`${API}/fr/cards?rarity=${encodeURIComponent(r.fr)}`))),
    getJSON(`${API}/graphql`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: gqlQuery }) }).catch(() => null),
    getJSON(`${API}/fr/sets`).catch(() => []),
  ]);

  const dexOf = new Map();
  if (gql?.data) for (const k of Object.keys(gql.data)) for (const c of gql.data[k] || []) dexOf.set(c.id, c.dexId || []);

  const raw = [];
  lists.forEach((list, i) => { for (const c of list) raw.push({ ...c, code: RARITIES[i].code }); });

  // Carte absente de GraphQL (retard de synchro) : on demande son détail pour obtenir le n° de Pokédex.
  const unknown = raw.filter(c => !dexOf.has(c.id));
  await pool(unknown, 6, async c => {
    try { const d = await getJSON(`${API}/fr/cards/${c.id}`); dexOf.set(c.id, d.dexId || []); } catch { /* sera retenté au prochain lancement */ }
  });

  const cards = [];
  for (const c of raw) {
    const dex = dexOf.get(c.id);
    if (!dex || !dex.length || !c.image) continue;       // dresseurs & co : ignorés
    cards.push({ id: c.id, d: dex, n: c.name, i: c.image, s: c.id.slice(0, c.id.lastIndexOf('-')), r: c.code, l: c.localId });
  }

  const known = new Set(cards.map(c => c.id));
  for (const c of legacy) if (!known.has(c.id)) cards.push(c);

  const sets = { ...(catalog?.sets || {}) };
  const names = new Map(allSets.map(s => [s.id, s]));
  const needed = [...new Set(cards.map(c => c.s))];
  await pool(needed, 6, async sid => {
    if (sets[sid]?.d) return;
    try {
      const s = await getJSON(`${API}/fr/sets/${sid}`);
      sets[sid] = { n: s.name, d: s.releaseDate || '', e: s.abbreviation?.localized || s.abbreviation?.official || '' };
    } catch { sets[sid] = sets[sid] || { n: names.get(sid)?.name || sid, d: '' }; }
  });
  return { t: Date.now(), cards, sets };
}

async function pool(items, size, fn) {
  const q = items.slice();
  await Promise.all(Array.from({ length: Math.min(size, q.length) }, async () => { while (q.length) await fn(q.shift()); }));
}

// ---------- Index ----------
function buildIndex() {
  byDex = new Map(); byId = new Map(); maxDex = MIN_DEX;
  const sets = catalog.sets;
  extraSets = {};
  const all = catalog.cards.concat(custom.filter(c => !catalog.cards.some(o => o.id === c.id)));
  for (const c of custom) if (!sets[c.s]) extraSets[c.s] = { n: c.sn || c.s, d: '' };
  const cmp = (a, b) => ((sets[a.s] || extraSets[a.s])?.d || '9999').localeCompare((sets[b.s] || extraSets[b.s])?.d || '9999') || a.s.localeCompare(b.s) || (parseInt(a.l.replace(/\D/g, '')) || 0) - (parseInt(b.l.replace(/\D/g, '')) || 0);
  for (const c of all) {
    byId.set(c.id, c);
    for (const d of c.d) { if (!byDex.has(d)) byDex.set(d, []); byDex.get(d).push(c); if (d > maxDex) maxDex = d; }
  }
  for (const list of byDex.values()) list.sort(cmp);
}
const dexName = n => pokedex[n] || byDex.get(n)?.[0]?.n.replace(/\s+(ex|EX|V|VMAX|VSTAR)$/, '') || `Pokémon #${n}`;
const setName = sid => catalog.sets[sid]?.n || extraSets[sid]?.n || sid;
const cardImg = (c, q = 'low') => c.u ? c.u[q === 'low' ? 0 : 1] : c.i ? `${c.i}/${q}.webp` : 'icons/card-back.svg';

// ---------- Prix ----------
const inflight = new Map();
let saveTimer;
function savePrices() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set('prices', prices), 800); }

function ensurePrice(id, force = false) {
  const p = prices[id];
  if (!force && p && Date.now() - p.t < PRICE_TTL) return Promise.resolve(p);
  if (inflight.has(id)) return inflight.get(id);
  const job = limit(async () => {
    try {
      const d = await getJSON(`${API}/fr/cards/${id}`);
      const cm = d.pricing?.cardmarket;
      prices[id] = { t: Date.now(), tr: cm?.trend || cm?.avg || null, avg: cm?.avg ?? null, low: cm?.low ?? null, up: cm?.updated || null };
      savePrices();
    } catch { /* garde l'ancien prix s'il existe */ }
    inflight.delete(id);
    paintPrice(id);
    return prices[id];
  });
  inflight.set(id, job);
  return job;
}
let active = 0; const waiting = [];
function limit(fn) {
  return new Promise((res, rej) => {
    const run = () => { active++; fn().then(res, rej).finally(() => { active--; waiting.shift()?.(); }); };
    active < 6 ? run() : waiting.push(run);
  });
}
function priceHTML(id) {
  const p = prices[id];
  const v = p?.tr != null ? eur(p.tr) : null;
  return `<span class="price${v ? '' : ' na'}" data-pid="${id}">${v || (p ? '—' : '…')}</span>`;
}
function paintPrice(id) {
  const p = prices[id];
  const v = p?.tr != null ? eur(p.tr) : null;
  document.querySelectorAll(`[data-pid="${id}"]`).forEach(el => { el.textContent = v || '—'; el.classList.toggle('na', !v); });
  if (tab === 'col') paintTotal();
  if (!$('#viewer').hidden && viewerId === id) paintViewerPrice();
}
function watchPrices(ids, force = false) { ids.forEach(id => ensurePrice(id, force)); }

// ---------- Rendu : Pokédex ----------
function ownedCount(dex) { return (byDex.get(dex) || []).filter(c => owned.has(c.id)).length; }

function tileHTML(n) {
  const list = byDex.get(n) || [];
  const o = ownedCount(n);
  const cls = ['tile', list.length ? 'has' : 'zero', list.length && o === list.length ? 'done' : ''].join(' ');
  return `<button class="${cls}" data-dex="${n}">
    <span class="num">${pad(n)}</span>${o ? `<span class="own">${o}/${list.length}</span>` : ''}
    <img src="${ARTWORK(n)}" alt="" loading="lazy" decoding="async" onerror="this.style.visibility='hidden'">
    <div class="nm">${esc(dexName(n))}</div>
    <div class="cnt">${list.length} carte${list.length > 1 ? 's' : ''}</div></button>`;
}

function renderDex() {
  const q = norm(query.trim());
  const out = [];
  for (let n = 1; n <= maxDex; n++) {
    const list = byDex.get(n) || [];
    if (filter === 'cards' && !list.length) continue;
    if (filter === 'missing' && (!list.length || ownedCount(n) === list.length)) continue;
    if (q && !(norm(dexName(n)).includes(q) || String(n) === q.replace(/^#?0*/, '') || pad(n).includes(q))) continue;
    out.push(tileHTML(n));
  }
  $('#dexGrid').innerHTML = out.join('') || '<div class="empty" style="grid-column:1/-1">Aucun Pokémon trouvé.</div>';
}
function refreshTile(n) {
  const el = $(`.tile[data-dex="${n}"]`);
  if (el) el.outerHTML = tileHTML(n);
}

// ---------- Rendu : feuille d'un Pokémon ----------
let sheetDex = null;
function pcardHTML(c) {
  const on = owned.has(c.id);
  return `<div class="pcard ${on ? 'on' : 'off'}" data-id="${c.id}">
    <div class="img"><img src="${cardImg(c)}" alt="${esc(c.n)}" loading="lazy">
      <span class="badge ${c.r}">${rar(c.r)}</span><button class="zoom" data-zoom="${c.id}" aria-label="Agrandir">⤢</button></div>
    <div class="meta"><span class="set">${esc(setName(c.s))} · n° ${esc(c.l)}</span>${priceHTML(c.id)}</div>
    <button class="check" data-toggle="${c.id}"><span class="box">✓</span><span>${on ? 'Dans ma collection' : 'Ajouter à ma collection'}</span></button>${c.r === 'PERSO' ? `<button class="mini" data-uncustom="${c.id}">Retirer de la liste</button>` : ''}</div>`;
}
function openSheet(n) {
  sheetDex = n;
  const list = byDex.get(n) || [];
  $('#shArt').src = ARTWORK(n);
  $('#shNum').textContent = `N° ${pad(n)}`;
  $('#shName').textContent = dexName(n);
  paintSheetInfo();
  $('#shCards').innerHTML = list.length
    ? list.map(pcardHTML).join('')
    : `<div class="empty" style="grid-column:1/-1">0 carte AR/SAR pour ce Pokémon.<br>Si une nouvelle extension en apporte une, elle apparaîtra ici automatiquement.</div>`;
  showModal('#sheet');
  $('#sheet .sheet-body').scrollTop = 0;
  watchPrices(list.map(c => c.id));
}
function paintSheetInfo() {
  const list = byDex.get(sheetDex) || [];
  const sets = [...new Set(list.map(c => setName(c.s)))];
  $('#shInfo').textContent = list.length ? `${list.length} carte${list.length > 1 ? 's' : ''} · ${ownedCount(sheetDex)} dans ma collection` : '';
  $('#shInfo').title = sets.join(', ');
}

// ---------- Rendu : collection ----------
function renderCollection() {
  const groups = [];
  for (const [dex, list] of [...byDex.entries()].sort((a, b) => a[0] - b[0])) {
    const mine = list.filter(c => owned.has(c.id) && c.d[0] === dex);   // carte multi-Pokémon : rangée sous le plus petit n°
    if (mine.length) groups.push([dex, mine]);
  }
  $('#colList').innerHTML = groups.length ? groups.map(([dex, mine]) => `
    <div class="col-group"><h3>#${pad(dex)} ${esc(dexName(dex))} <span>${mine.length} carte${mine.length > 1 ? 's' : ''}</span></h3>
      <div class="col-cards">${mine.map(c => `<button class="ccard" data-view="${c.id}"><div class="img"><img src="${cardImg(c)}" alt="${esc(c.n)}" loading="lazy"></div>${priceHTML(c.id)}</button>`).join('')}</div>
    </div>`).join('')
    : `<div class="empty">Ta collection est vide.<br>Va dans « Toutes les cartes », choisis un Pokémon et coche tes cartes.</div>`;
  watchPrices(groups.flatMap(([, m]) => m.map(c => c.id)));
  paintTotal();
}
function paintTotal() {
  const mine = [...owned].filter(id => byId.has(id));
  let sum = 0, known = 0;
  for (const id of mine) { const v = prices[id]?.tr; if (v != null) { sum += v; known++; } }
  const pending = mine.length - known;
  $('#colSummary').innerHTML = `<span><b>${mine.length}</b> carte${mine.length > 1 ? 's' : ''}</span>
    <span class="total">Valeur : <b>${eur(sum)}</b>${pending ? ` <small>(${pending} prix en attente)</small>` : ''}</span>`;
}

// ---------- Visionneuse ----------
let viewerId = null;
function openViewer(id) {
  const c = byId.get(id); if (!c) return;
  viewerId = id;
  $('#vImg').src = cardImg(c, 'high');
  $('#vInfo').innerHTML = `<h2>${esc(c.n)} <span class="badge-inline ${c.r}">${rar(c.r)}</span></h2>
    <div class="muted">${esc(setName(c.s))} · n° ${esc(c.l)}</div><div id="vPrice"></div>`;
  paintViewerPrice(); paintViewerBtn();
  showModal('#viewer');
  ensurePrice(id);
}
function paintViewerPrice() {
  const p = prices[viewerId];
  const el = $('#vPrice'); if (!el) return;
  if (!p) { el.innerHTML = '<div class="muted">Chargement du prix…</div>'; return; }
  const d = p.up ? new Date(p.up).toLocaleDateString('fr-FR') : null;
  el.innerHTML = p.tr != null
    ? `<div class="big">${eur(p.tr)}</div><div class="muted">Cote Cardmarket (tendance)${p.avg != null ? ` · moy. ${eur(p.avg)}` : ''}${p.low != null ? ` · dès ${eur(p.low)}` : ''}${d ? `<br>mis à jour le ${d}` : ''}</div>`
    : '<div class="muted">Pas de prix disponible</div>';
}
function paintViewerBtn() {
  const b = $('#vToggle'), on = owned.has(viewerId);
  b.textContent = on ? 'Retirer de ma collection' : 'Ajouter à ma collection';
  b.classList.toggle('danger', on);
}

// ---------- Actions ----------
function toggle(id) {
  if (owned.has(id)) owned.delete(id); else owned.add(id);
  store.set('owned', [...owned]);
  const c = byId.get(id);
  $('#colCount').textContent = [...owned].filter(i => byId.has(i)).length;
  document.querySelectorAll(`.pcard[data-id="${id}"]`).forEach(el => {
    const on = owned.has(id);
    el.classList.toggle('on', on); el.classList.toggle('off', !on);
    el.querySelector('.check span:last-child').textContent = on ? 'Dans ma collection' : 'Ajouter à ma collection';
  });
  if (c) c.d.forEach(refreshTile);
  if (sheetDex != null && !$('#sheet').hidden) paintSheetInfo();
  if (tab === 'col') renderCollection();
}

function setTab(t) {
  tab = t;
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  $('#viewDex').hidden = t !== 'dex'; $('#viewCol').hidden = t !== 'col';
  $('#dexTools').hidden = t !== 'dex'; $('#colSummary').hidden = t !== 'col';
  $('#title').textContent = t === 'dex' ? 'Tous les Pokémon' : 'Ma collection';
  if (t === 'col') renderCollection();
  window.scrollTo(0, 0);
}

// ---------- Fenêtres (avec bouton retour du téléphone) ----------
const stack = [];
function showModal(sel) {
  $(sel).hidden = false; stack.push(sel);
  history.pushState({ m: sel }, '');
}
function hideTop(fromPop) {
  const sel = stack.pop(); if (!sel) return;
  $(sel).hidden = true;
  if (!fromPop) history.back();
}
window.addEventListener('popstate', () => { if (stack.length) hideTop(true); });

let toastTimer;
function toast(msg, ms = 4000) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, ms);
}

// ---------- Export / import ----------
async function exportCollection() {
  const data = JSON.stringify({ app: 'vitrine-ar-sar', date: new Date().toISOString(), owned: [...owned] }, null, 1);
  const file = new File([data], 'ma-collection-pokemon.json', { type: 'application/json' });
  try {
    if (navigator.canShare?.({ files: [file] })) { await navigator.share({ files: [file], title: 'Ma collection' }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function importCollection(file) {
  try {
    const d = JSON.parse(await file.text());
    if (!Array.isArray(d.owned)) throw new Error();
    const before = owned.size;
    d.owned.forEach(id => typeof id === 'string' && owned.add(id));
    store.set('owned', [...owned]);
    $('#colCount').textContent = [...owned].filter(i => byId.has(i)).length;
    renderDex(); if (tab === 'col') renderCollection();
    toast(`${owned.size - before} carte(s) ajoutée(s)`);
  } catch { toast('Fichier non valide'); }
}

// ---------- Chargement ----------
function applyCatalog(newCat, announce) {
  const oldIds = new Set((catalog?.cards || []).map(c => c.id));
  const fresh = newCat.cards.filter(c => !oldIds.has(c.id));
  catalog = newCat; store.set('catalog', catalog);
  buildIndex(); renderDex();
  $('#colCount').textContent = [...owned].filter(i => byId.has(i)).length;
  if (tab === 'col') renderCollection();
  if (sheetDex != null && !$('#sheet').hidden) openSheetKeep();
  $('#menuInfo').textContent = `${catalog.cards.length} cartes AR/SAR · catalogue du ${new Date(catalog.t).toLocaleString('fr-FR')}`;
  if (announce && fresh.length) {
    const sets = [...new Set(fresh.map(c => setName(c.s)))];
    toast(`🆕 ${fresh.length} nouvelle${fresh.length > 1 ? 's' : ''} carte${fresh.length > 1 ? 's' : ''} : ${sets.slice(0, 3).join(', ')}`, 7000);
  }
}
function openSheetKeep() { // re-rend la feuille ouverte sans empiler l'historique
  const list = byDex.get(sheetDex) || [];
  $('#shCards').innerHTML = list.map(pcardHTML).join('') || $('#shCards').innerHTML;
  paintSheetInfo(); watchPrices(list.map(c => c.id));
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

function currentPriceIds() {
  const ids = new Set();
  if (tab === 'col') owned.forEach(id => byId.has(id) && ids.add(id));
  if (!$('#sheet').hidden) (byDex.get(sheetDex) || []).forEach(c => ids.add(c.id));
  return [...ids];
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
  const rows = pickerCards.filter(c => !byId.has(c.id) && (!q || norm(`${sn(c)} ${c.localId} ${c.rarity || ''}`).includes(q)))
    .sort((a, b) => sn(a).localeCompare(sn(b)) || (parseInt(a.localId) || 0) - (parseInt(b.localId) || 0));
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
    const entry = { id: d.id, d: d.dexId?.length ? d.dexId : [pickerDex], n: d.name, s: d.set.id, sn: d.set.name, r: 'PERSO', l: String(d.localId) };
    if (d.image) entry.i = d.image;
    else if (tp) entry.u = [`https://tcgplayer-cdn.tcgplayer.com/product/${tp}_200w.jpg`, `https://tcgplayer-cdn.tcgplayer.com/product/${tp}_400w.jpg`];
    custom.push(entry); store.set('custom', custom);
    buildIndex(); renderDex();
    if (sheetDex != null) openSheetKeep();
    renderPicker();
    toast(`${entry.n} ajoutée à la liste de ${dexName(pickerDex)}`);
  } catch { btn.disabled = false; btn.textContent = 'Réessayer'; toast('Échec — vérifie ta connexion'); }
}
function removeCustom(id) {
  custom = custom.filter(c => c.id !== id); store.set('custom', custom);
  owned.delete(id); store.set('owned', [...owned]);
  buildIndex(); renderDex();
  $('#colCount').textContent = [...owned].filter(i => byId.has(i)).length;
  if (sheetDex != null) { openSheetKeep(); if (!(byDex.get(sheetDex) || []).length) $('#shCards').innerHTML = ''; }
  if (tab === 'col') renderCollection();
}

// ---------- Événements ----------
document.addEventListener('click', e => {
  const t = e.target;
  if (t.closest('[data-close]')) return hideTop();
  const pk = t.closest('[data-pick]'); if (pk) return addCustom(pk.dataset.pick, pk);
  const uc = t.closest('[data-uncustom]'); if (uc) return removeCustom(uc.dataset.uncustom);
  if (t.closest('#addCardBtn')) return openPicker(sheetDex);
  const tile = t.closest('[data-dex]'); if (tile) return openSheet(+tile.dataset.dex);
  const z = t.closest('[data-zoom]'); if (z) return openViewer(z.dataset.zoom);
  const tg = t.closest('[data-toggle]'); if (tg) return toggle(tg.dataset.toggle);
  const v = t.closest('[data-view]'); if (v) return openViewer(v.dataset.view);
  const tb = t.closest('.tab'); if (tb) return setTab(tb.dataset.tab);
  const ch = t.closest('.chip'); if (ch) {
    filter = ch.dataset.f;
    document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c === ch));
    return renderDex();
  }
  if (t.closest('#menuBtn')) return showModal('#menu');
  if (t.closest('#retry')) { $('#loading').textContent = 'Chargement du catalogue…'; return refreshCatalog({ force: true }); }
  if (t.closest('#refreshBtn')) {
    hideTop(); toast('Actualisation…', 2000);
    return refreshCatalog({ force: true }).then(() => { watchPrices(currentPriceIds(), true); if (tab === 'dex') toast('Catalogue à jour ✔'); });
  }
  if (t.closest('#exportBtn')) return exportCollection();
  if (t.closest('#importBtn')) return $('#importFile').click();
  if (t.closest('#vToggle')) { toggle(viewerId); paintViewerBtn(); }
});
$('#importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importCollection(f); e.target.value = ''; });
$('#pkSearch').addEventListener('input', renderPicker);
$('#search').addEventListener('input', e => { query = e.target.value; renderDex(); });

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (Date.now() - hiddenAt > CATALOG_MAX_AGE) refreshCatalog().then(() => watchPrices(currentPriceIds()));
});

// ---------- Démarrage ----------
(async function init() {
  try { pokedex = await getJSON('data/pokedex.json'); } catch { pokedex = {}; }
  try { legacy = (await Promise.all(['legacy-alt', 'legacy-gallery', 'legacy-promo', 'legacy-scenes'].map(f => getJSON(`data/${f}.json`)))).flat(); } catch { legacy = []; }
  if (catalog) { buildIndex(); renderDex(); $('#loading').hidden = true; $('#colCount').textContent = [...owned].filter(i => byId.has(i)).length; }
  await refreshCatalog({ announce: true });
  if (catalog) $('#menuInfo').textContent = `${catalog.cards.length} cartes AR/SAR · catalogue du ${new Date(catalog.t).toLocaleString('fr-FR')}`;
})();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
