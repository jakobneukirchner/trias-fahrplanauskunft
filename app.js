// app.js – Main application logic
import { saveTrip, getAllTrips, deleteTrip } from './db.js';
import {
  buildTripRequest, buildLocationRequest,
  postTrias, parseTripResponse, parseLocationResponse,
  depInMin
} from './trias.js';

// ── Region-priority POIs ──
const LOCAL_POIS = [
  { name: 'Braunschweig Hauptbahnhof',  ref: 'de:03101:1',  type: 'stop', local: true },
  { name: 'Braunschweig Rathaus',        ref: 'de:03101:12', type: 'stop', local: true },
  { name: 'Braunschweig Volkmarode',     ref: 'de:03101:71', type: 'stop', local: true },
  { name: 'Braunschweig Hagenmarkt',     ref: 'de:03101:10', type: 'stop', local: true },
  { name: 'Braunschweig Schloss',        ref: 'de:03101:13', type: 'stop', local: true },
  { name: 'Braunschweig Pockelsstraße',  ref: 'de:03101:20', type: 'stop', local: true },
  { name: 'Braunschweig Heidberg',       ref: 'de:03101:30', type: 'stop', local: true },
  { name: 'Braunschweig Siegfriedviertel', ref: 'de:03101:50', type: 'stop', local: true },
  { name: 'Hannover Hauptbahnhof',       ref: 'de:03241:11', type: 'stop', local: true },
  { name: 'Hannover Kröpcke',            ref: 'de:03241:46', type: 'stop', local: true },
  { name: 'Hannover Bismarckstraße',     ref: 'de:03241:90', type: 'stop', local: true },
];

// ── State ──
let pendingTrip      = null;
let tripViewInterval = null;
let activeTripId     = null;
let isArrival        = false;

// ── DOM ──
const inputOrigin    = document.getElementById('input-origin');
const inputDest      = document.getElementById('input-dest');
const inputTime      = document.getElementById('input-time');
const acOrigin       = document.getElementById('ac-origin');
const acDest         = document.getElementById('ac-dest');
const btnSearch      = document.getElementById('btn-search');
const btnSearchLabel = document.getElementById('btn-search-label');
const btnSaved       = document.getElementById('btn-saved');
const btnSwap        = document.getElementById('btn-swap');
const btnCloseSaved  = document.getElementById('btn-close-saved');
const chipDep        = document.getElementById('chip-dep');
const chipArr        = document.getElementById('chip-arr');
const clearOrigin    = document.getElementById('clear-origin');
const clearDest      = document.getElementById('clear-dest');
const sectionResults = document.getElementById('section-results');
const resultsList    = document.getElementById('results-list');
const resultsTtl     = document.getElementById('results-title');
const sectionSaved   = document.getElementById('section-saved');
const savedList      = document.getElementById('saved-list');
const loadingEl      = document.getElementById('loading');
const errorBox       = document.getElementById('error-box');
const errorMsg       = document.getElementById('error-msg');
const snackbar       = document.getElementById('snackbar');
const snackLabel     = document.getElementById('snackbar-label');
const snackIcon      = document.getElementById('snackbar-icon');
const saveDialog     = document.getElementById('save-dialog');
const dialogCancel   = document.getElementById('dialog-cancel');
const dialogSaveBtn  = document.getElementById('dialog-save');
const dialogSummary  = document.getElementById('dialog-trip-summary');
const dialogName     = document.getElementById('dialog-name');
const dialogRecur    = document.getElementById('dialog-recurrence');
const tripView       = document.getElementById('trip-view');
const tvLine         = document.getElementById('tv-line');
const tvDest         = document.getElementById('tv-dest');
const tvMin          = document.getElementById('tv-min');
const tvPlatform     = document.getElementById('tv-platform');
const tvDelay        = document.getElementById('tv-delay');
const tvDelayRow     = document.getElementById('tv-delay-row');
const tvClose        = document.getElementById('tv-close');

// ── Init ──
window.addEventListener('DOMContentLoaded', async () => {
  setDefaultTime();
  await checkImminentTrips();
  setInterval(checkImminentTrips, 60_000);
});

function setDefaultTime() {
  const now = new Date();
  now.setSeconds(0, 0);
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  inputTime.value = local.toISOString().slice(0, 16);
}

// ── Departure / Arrival toggle ──
chipDep.addEventListener('click', () => {
  isArrival = false;
  chipDep.classList.remove('chip--outline');
  chipArr.classList.add('chip--outline');
});
chipArr.addEventListener('click', () => {
  isArrival = true;
  chipArr.classList.remove('chip--outline');
  chipDep.classList.add('chip--outline');
});

// ── Swap button ──
btnSwap.addEventListener('click', () => {
  const tmpVal  = inputOrigin.value;
  const tmpRef  = inputOrigin.dataset.ref  || '';
  const tmpType = inputOrigin.dataset.type || '';
  inputOrigin.value        = inputDest.value;
  inputOrigin.dataset.ref  = inputDest.dataset.ref  || '';
  inputOrigin.dataset.type = inputDest.dataset.type || '';
  inputDest.value          = tmpVal;
  inputDest.dataset.ref    = tmpRef;
  inputDest.dataset.type   = tmpType;
});

// ── Clear buttons ──
clearOrigin.addEventListener('click', () => { inputOrigin.value = ''; delete inputOrigin.dataset.ref; delete inputOrigin.dataset.type; inputOrigin.focus(); });
clearDest.addEventListener('click',   () => { inputDest.value   = ''; delete inputDest.dataset.ref;   delete inputDest.dataset.type;   inputDest.focus(); });

// ── Autocomplete ──
function attachAC(input, list) {
  let timer;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => fetchAC(input.value, list, input), 280); });
  input.addEventListener('blur',  () => setTimeout(() => { list.innerHTML = ''; }, 180));
  input.addEventListener('keydown', e => handleACKey(e, list, input));
}

async function fetchAC(text, list, input) {
  list.innerHTML = '';
  if (text.length < 2) return;
  const local = LOCAL_POIS.filter(p => p.name.toLowerCase().includes(text.toLowerCase()));
  let remote = [];
  try {
    const resp = await postTrias(buildLocationRequest(text));
    remote = parseLocationResponse(resp).filter(r => !local.some(l => l.ref === r.ref));
  } catch (_) {}
  renderAC(list, [...local, ...remote].slice(0, 8), input);
}

function renderAC(list, items, input) {
  items.forEach((item, i) => {
    const li = document.createElement('li');
    li.className = 'ac-item';
    li.innerHTML = `
      <span class="material-icons">${item.type === 'stop' ? 'directions_transit' : 'place'}</span>
      <span class="ac-item__name">${escHtml(item.name)}</span>
      ${item.local ? '<span class="ac-badge">Region</span>' : ''}`;
    li.addEventListener('mousedown', e => { e.preventDefault(); selectAC(input, list, item); });
    list.appendChild(li);
  });
}

function selectAC(input, list, item) {
  input.value = item.name;
  input.dataset.ref  = item.ref;
  input.dataset.type = item.type;
  list.innerHTML = '';
}

function handleACKey(e, list, input) {
  const items = list.querySelectorAll('.ac-item');
  if (!items.length) return;
  const current = list.querySelector('.ac-item.focused');
  let idx = [...items].indexOf(current);
  if (e.key === 'ArrowDown') { e.preventDefault(); idx = Math.min(idx + 1, items.length - 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); }
  else if (e.key === 'Enter' && current) { e.preventDefault(); const item = { name: current.querySelector('.ac-item__name').textContent, ref: '', type: '' }; selectAC(input, list, item); return; }
  else return;
  items.forEach(el => el.classList.remove('focused'));
  items[idx]?.classList.add('focused');
  items[idx]?.scrollIntoView({ block: 'nearest' });
}

attachAC(inputOrigin, acOrigin);
attachAC(inputDest,   acDest);

// ── Search ──
btnSearch.addEventListener('click', doSearch);
inputOrigin.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
inputDest.addEventListener('keydown',   e => { if (e.key === 'Enter') doSearch(); });

async function doSearch() {
  const originRef  = inputOrigin.dataset.ref  || inputOrigin.value.trim();
  const originType = inputOrigin.dataset.type || 'address';
  const destRef    = inputDest.dataset.ref    || inputDest.value.trim();
  const destType   = inputDest.dataset.type   || 'address';
  const timeVal    = inputTime.value;

  if (!originRef || !destRef) { showSnack('Bitte Start und Ziel eingeben.', true); return; }
  if (!timeVal) { showSnack('Bitte Abfahrtszeit angeben.', true); return; }

  const depIso = new Date(timeVal).toISOString();

  setLoading(true);
  hideError();
  sectionResults.classList.add('hidden');

  try {
    const xml   = buildTripRequest({ originRef, originType, destRef, destType, depIso, algorithm: isArrival ? 'minChanges' : 'minChanges' });
    const resp  = await postTrias(xml);
    const trips = parseTripResponse(resp);
    renderResults(trips, { originRef, originType, destRef, destType, depIso });
  } catch (err) {
    showError(err.message);
    console.error(err);
  } finally {
    setLoading(false);
  }
}

// ── Render Results ──
function renderResults(trips, sp) {
  resultsList.innerHTML = '';
  if (!trips.length) {
    resultsList.innerHTML = '<p style="color:var(--text-sec);padding:8px 0">Keine Verbindungen gefunden.</p>';
  } else {
    resultsTtl.textContent = `${trips.length} Verbindung${trips.length > 1 ? 'en' : ''}`;
    trips.forEach(trip => resultsList.appendChild(buildResultCard(trip, sp)));
  }
  sectionResults.classList.remove('hidden');
  sectionSaved.classList.add('hidden');
  sectionResults.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function buildResultCard(trip, sp) {
  const s = trip.summary || {};
  const card = document.createElement('div');
  card.className = 'result-card';

  const depMin  = depInMin(s.depTime);
  const depStr  = fmtTime(s.depTime);
  const arrStr  = fmtTime(s.arrTime);
  const delayBadge = s.depDelay > 0 ? `<span class="delay-badge">+${s.depDelay} min</span>` : '';
  const platStr = s.platform || 'k. A.';
  const dur     = s.arrTime && s.depTime ? durationStr(s.depTime, s.arrTime) : '';

  const legsHtml = trip.legs.map(leg => {
    if (leg.type === 'walk') return `
      <li class="ps-item">
        <span class="ps-dot ps-dot--walk"></span>
        <div class="ps-info"><div class="ps-name">🚶 Fußweg</div></div>
      </li>`;
    const delay = leg.depDelay > 0 ? ` <span style="color:var(--warn);font-size:.75rem">(+${leg.depDelay} min)</span>` : '';
    return `
      <li class="ps-item">
        <span class="ps-dot"></span>
        <div class="ps-info">
          <div class="ps-name">${escHtml(leg.line)} <span style="font-weight:400">→ ${escHtml(leg.dest)}</span></div>
          <div class="ps-detail">${escHtml(leg.fromName)} · ${fmtTime(leg.scheduledDep)}${delay}</div>
        </div>
      </li>
      <li class="ps-item">
        <span class="ps-dot" style="background:var(--divider);box-shadow:0 0 0 2px var(--surface),0 0 0 3.5px var(--divider)"></span>
        <div class="ps-info"><div class="ps-detail">${escHtml(leg.toName)} · Ankunft ${fmtTime(leg.scheduledArr)}</div></div>
      </li>`;
  }).join('');

  card.innerHTML = `
    <div class="rc-header">
      <span class="rc-line">${escHtml(s.line || '?')}</span>
      <span class="rc-dest">→ ${escHtml(s.dest || s.to || '?')}</span>
      <span class="rc-time">${depStr}${arrStr ? ' – ' + arrStr : ''}</span>
    </div>
    <div class="rc-body">
      <div class="rc-stats">
        <div class="rc-stat"><span class="material-icons">schedule</span> Abfahrt in <strong>${depMin} min</strong>${delayBadge}</div>
        <div class="rc-stat"><span class="material-icons">train</span> Gleis <strong>${escHtml(platStr)}</strong></div>
        ${dur ? `<div class="rc-stat"><span class="material-icons">timelapse</span> <strong>${dur}</strong></div>` : ''}
      </div>
      <ul class="perlschnur">${legsHtml}</ul>
    </div>
    <div class="rc-actions">
      <button class="btn-outline btn-save" style="font-size:.82rem;padding:6px 14px">
        <span class="material-icons" style="font-size:17px">bookmark_add</span> Speichern
      </button>
    </div>`;

  card.querySelector('.btn-save').addEventListener('click', () => openSaveDialog(trip, sp));
  return card;
}

// ── Save Dialog ──
function openSaveDialog(trip, sp) {
  const s = trip.summary || {};
  dialogSummary.textContent = `${s.from || sp.originRef} → ${s.to || sp.destRef}`;
  dialogName.value  = '';
  dialogRecur.value = 'none';
  pendingTrip = { trip, sp };
  saveDialog.classList.remove('hidden');
}

dialogCancel.addEventListener('click',  () => saveDialog.classList.add('hidden'));
saveDialog.addEventListener('click', e => { if (e.target === saveDialog) saveDialog.classList.add('hidden'); });

dialogSaveBtn.addEventListener('click', async () => {
  if (!pendingTrip) return;
  const { trip, sp } = pendingTrip;
  const s  = trip.summary || {};
  const id = crypto.randomUUID();
  await saveTrip({
    id, name: dialogName.value.trim() || `${s.from || sp.originRef} → ${s.to || sp.destRef}`,
    originRef: sp.originRef, originType: sp.originType,
    destRef:   sp.destRef,   destType:   sp.destType,
    depIso: sp.depIso, recurrence: dialogRecur.value,
    line: s.line, dest: s.dest, platform: s.platform,
    createdAt: new Date().toISOString(),
  });
  saveDialog.classList.add('hidden');
  pendingTrip = null;
  showSnack('Fahrt gespeichert ✓');
});

// ── Saved Trips ──
btnSaved.addEventListener('click',      showSaved);
btnCloseSaved.addEventListener('click', () => sectionSaved.classList.add('hidden'));

async function showSaved() {
  const trips = await getAllTrips();
  savedList.innerHTML = '';
  sectionResults.classList.add('hidden');
  if (!trips.length) {
    savedList.innerHTML = '<p style="color:var(--text-sec);padding:8px 0">Noch keine Fahrten gespeichert.</p>';
  } else {
    trips.forEach(t => savedList.appendChild(buildSavedCard(t)));
  }
  sectionSaved.classList.remove('hidden');
  sectionSaved.scrollIntoView({ behavior: 'smooth' });
}

function buildSavedCard(t) {
  const card = document.createElement('div');
  card.className = 'saved-card';
  const rl = { none: '', daily: '• täglich', weekdays: '• Mo–Fr', weekly: '• wöchentlich' }[t.recurrence] || '';
  card.innerHTML = `
    <span class="material-icons">bookmark</span>
    <div class="saved-card__info">
      <div class="saved-card__name">${escHtml(t.name)}</div>
      <div class="saved-card__detail">${escHtml(t.line || '')} ${rl} · ${fmtTime(t.depIso)}</div>
    </div>
    <div class="saved-card__actions">
      <button class="icon-btn btn-search-saved" title="Jetzt suchen"><span class="material-icons">search</span></button>
      <button class="icon-btn btn-del-saved" title="Löschen"><span class="material-icons">delete</span></button>
    </div>`;
  card.querySelector('.btn-search-saved').addEventListener('click', () => runSaved(t));
  card.querySelector('.btn-del-saved').addEventListener('click', async () => { await deleteTrip(t.id); card.remove(); showSnack('Fahrt gelöscht.'); });
  return card;
}

async function runSaved(t) {
  sectionSaved.classList.add('hidden');
  const depIso = computeNextDep(t);
  setLoading(true); hideError(); sectionResults.classList.add('hidden');
  try {
    const xml   = buildTripRequest({ originRef: t.originRef, originType: t.originType, destRef: t.destRef, destType: t.destType, depIso });
    const resp  = await postTrias(xml);
    const trips = parseTripResponse(resp);
    renderResults(trips, { originRef: t.originRef, originType: t.originType, destRef: t.destRef, destType: t.destType, depIso });
  } catch (err) { showError(err.message); }
  finally { setLoading(false); }
}

// ── Imminent Trip Check ──
async function checkImminentTrips() {
  const trips = await getAllTrips();
  const now   = Date.now();
  for (const t of trips) {
    const next = new Date(computeNextDep(t)).getTime();
    if (now >= next - 10 * 60_000 && now <= next + 5 * 60_000) { openTripView(t); return; }
  }
}

function openTripView(t) {
  if (activeTripId === t.id) return;
  activeTripId = t.id;
  tvLine.textContent     = t.line     || '–';
  tvDest.textContent     = t.dest     || '–';
  tvPlatform.textContent = t.platform || 'k. A.';
  updateCountdown(t);
  tripView.classList.remove('hidden');
  clearInterval(tripViewInterval);
  tripViewInterval = setInterval(() => { updateCountdown(t); updateTripViewLive(t); }, 30_000);
}

tvClose.addEventListener('click', () => { tripView.classList.add('hidden'); clearInterval(tripViewInterval); activeTripId = null; });

function updateCountdown(t) {
  const ms = new Date(computeNextDep(t)).getTime() - Date.now();
  tvMin.textContent = Math.max(0, Math.round(ms / 60000));
}

async function updateTripViewLive(t) {
  try {
    const depIso = computeNextDep(t);
    const xml    = buildTripRequest({ originRef: t.originRef, originType: t.originType, destRef: t.destRef, destType: t.destType, depIso });
    const resp   = await postTrias(xml);
    const trips  = parseTripResponse(resp);
    if (!trips.length) return;
    const s = trips[0].summary || {};
    tvMin.textContent = depInMin(s.depTime);
    if (s.platform) tvPlatform.textContent = s.platform;
    tvDelayRow.classList.toggle('hidden', !(s.depDelay > 0));
    if (s.depDelay > 0) tvDelay.textContent = s.depDelay;
  } catch (_) {}
}

// ── Recurrence ──
function computeNextDep(t) {
  if (!t.recurrence || t.recurrence === 'none') return t.depIso;
  const base   = new Date(t.depIso);
  const target = new Date();
  target.setHours(base.getHours(), base.getMinutes(), 0, 0);
  if (target <= new Date()) target.setDate(target.getDate() + 1);
  if (t.recurrence === 'weekdays') while ([0, 6].includes(target.getDay())) target.setDate(target.getDate() + 1);
  if (t.recurrence === 'weekly')   while (target.getDay() !== base.getDay())  target.setDate(target.getDate() + 1);
  return target.toISOString();
}

// ── Helpers ──
function setLoading(on) {
  loadingEl.classList.toggle('hidden', !on);
  btnSearch.disabled = on;
  btnSearchLabel.textContent = on ? 'Suche läuft…' : 'Verbindung suchen';
}
function showError(msg) { errorMsg.textContent = msg; errorBox.classList.remove('hidden'); }
function hideError()    { errorBox.classList.add('hidden'); }

function showSnack(msg, isErr = false) {
  snackLabel.textContent = msg;
  snackIcon.textContent  = isErr ? 'error_outline' : 'check_circle';
  snackbar.classList.toggle('snackbar--error', isErr);
  snackbar.classList.add('show');
  setTimeout(() => snackbar.classList.remove('show'), 3200);
}

function fmtTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }
  catch { return iso; }
}

function durationStr(dep, arr) {
  const m = Math.round((new Date(arr) - new Date(dep)) / 60000);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
