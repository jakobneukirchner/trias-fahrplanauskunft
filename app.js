// ============================================================
// app.js – Main application logic
// ============================================================
import { saveTrip, getAllTrips, deleteTrip } from './db.js';
import {
  buildTripRequest, buildLocationRequest,
  postTrias, parseTripResponse, parseLocationResponse,
  depInMin
} from './trias.js';

// ---- Region-priority POIs (Braunschweig + Hannover) ----
// Add more stops/addresses here for your target region.
// Format: { name, ref, type:'stop'|'address', local:true }
const LOCAL_POIS = [
  { name: 'Braunschweig Hauptbahnhof', ref: 'de:03101:1', type: 'stop', local: true },
  { name: 'Braunschweig Rathaus', ref: 'de:03101:12', type: 'stop', local: true },
  { name: 'Braunschweig Volkmarode', ref: 'de:03101:71', type: 'stop', local: true },
  { name: 'Braunschweig Hagenmarkt', ref: 'de:03101:10', type: 'stop', local: true },
  { name: 'Braunschweig Schloss', ref: 'de:03101:13', type: 'stop', local: true },
  { name: 'Braunschweig Pockelsstraße', ref: 'de:03101:20', type: 'stop', local: true },
  { name: 'Hannover Hauptbahnhof', ref: 'de:03241:11', type: 'stop', local: true },
  { name: 'Hannover Kröpcke', ref: 'de:03241:46', type: 'stop', local: true },
];

// ---- State ----
let pendingTrip = null;   // trip to save from dialog
let tripViewInterval = null;
let activeTripId = null;

// ---- DOM Refs ----
const inputOrigin   = document.getElementById('input-origin');
const inputDest     = document.getElementById('input-dest');
const inputTime     = document.getElementById('input-time');
const acOrigin      = document.getElementById('ac-origin');
const acDest        = document.getElementById('ac-dest');
const btnSearch     = document.getElementById('btn-search');
const btnSaved      = document.getElementById('btn-saved');
const sectionResults= document.getElementById('section-results');
const resultsList   = document.getElementById('results-list');
const sectionSaved  = document.getElementById('section-saved');
const savedList     = document.getElementById('saved-list');
const snackbar      = document.getElementById('snackbar');
const snackLabel    = document.getElementById('snackbar-label');
const saveDialog    = document.getElementById('save-dialog');
const dialogCancel  = document.getElementById('dialog-cancel');
const dialogSave    = document.getElementById('dialog-save');
const dialogSummary = document.getElementById('dialog-trip-summary');
const dialogName    = document.getElementById('dialog-name');
const dialogRecur   = document.getElementById('dialog-recurrence');
const tripView      = document.getElementById('trip-view');
const tvLine        = document.getElementById('tv-line');
const tvDest        = document.getElementById('tv-dest');
const tvMin         = document.getElementById('tv-min');
const tvPlatform    = document.getElementById('tv-platform');
const tvDelay       = document.getElementById('tv-delay');
const tvDelayRow    = document.getElementById('tv-delay-row');
const tvClose       = document.getElementById('tv-close');

// ---- Init ----
window.addEventListener('DOMContentLoaded', async () => {
  // Set default time to now
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  inputTime.value = now.toISOString().slice(0, 16);

  // Check for imminent saved trips on open
  await checkImminentTrips();

  // Start background check every 60 s
  setInterval(checkImminentTrips, 60_000);
});

// ---- Autocomplete ----
function attachAutocomplete(input, list) {
  let debounceTimer;
  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => fetchSuggestions(input.value, list), 300);
  });
  input.addEventListener('blur', () => setTimeout(() => { list.innerHTML = ''; }, 200));
}

async function fetchSuggestions(text, list) {
  list.innerHTML = '';
  if (text.length < 2) return;

  // 1. Local POIs first
  const localMatches = LOCAL_POIS.filter(p =>
    p.name.toLowerCase().includes(text.toLowerCase())
  );

  // 2. Remote suggestions
  let remoteResults = [];
  try {
    const xml = buildLocationRequest(text);
    const resp = await postTrias(xml);
    remoteResults = parseLocationResponse(resp)
      .filter(r => !localMatches.some(l => l.ref === r.ref));
  } catch (_) { /* ignore autocomplete errors */ }

  const all = [...localMatches, ...remoteResults].slice(0, 8);
  all.forEach(item => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="material-icons" style="font-size:18px;color:#9e9e9e">${item.type === 'stop' ? 'train' : 'place'}</span>
      ${escHtml(item.name)}
      ${item.local ? '<span class="local-badge">Region</span>' : ''}
    `;
    li.addEventListener('mousedown', () => {
      list.closest('.search-field-wrap').querySelector('input').value = item.name;
      list.closest('.search-field-wrap').querySelector('input').dataset.ref  = item.ref;
      list.closest('.search-field-wrap').querySelector('input').dataset.type = item.type;
      list.innerHTML = '';
    });
    list.appendChild(li);
  });
}

attachAutocomplete(inputOrigin, acOrigin);
attachAutocomplete(inputDest, acDest);

// ---- Search ----
btnSearch.addEventListener('click', async () => {
  const originRef  = inputOrigin.dataset.ref  || inputOrigin.value;
  const originType = inputOrigin.dataset.type || 'address';
  const destRef    = inputDest.dataset.ref    || inputDest.value;
  const destType   = inputDest.dataset.type   || 'address';
  const timeVal    = inputTime.value;

  if (!originRef || !destRef || !timeVal) {
    showSnack('Bitte Start, Ziel und Zeit angeben.');
    return;
  }

  const depIso = new Date(timeVal).toISOString();
  btnSearch.disabled = true;
  btnSearch.querySelector('.mdc-button__label').textContent = 'Suche läuft…';

  try {
    const xml  = buildTripRequest({ originRef, originType, destRef, destType, depIso });
    const resp = await postTrias(xml);
    const trips = parseTripResponse(resp);
    renderResults(trips, { originRef, originType, destRef, destType, depIso });
  } catch (err) {
    showSnack('Fehler: ' + err.message);
    console.error(err);
  } finally {
    btnSearch.disabled = false;
    btnSearch.querySelector('.mdc-button__label').textContent = 'Suchen';
  }
});

// ---- Render Results ----
function renderResults(trips, searchParams) {
  resultsList.innerHTML = '';
  if (!trips.length) {
    resultsList.innerHTML = '<p style="color:#757575">Keine Verbindungen gefunden.</p>';
  } else {
    trips.forEach(trip => {
      resultsList.appendChild(buildResultCard(trip, searchParams));
    });
  }
  sectionResults.classList.remove('hidden');
  sectionSaved.classList.add('hidden');
  sectionResults.scrollIntoView({ behavior: 'smooth' });
}

function buildResultCard(trip, searchParams) {
  const s = trip.summary || {};
  const card = document.createElement('div');
  card.className = 'result-card';

  const minUntil = depInMin(s.depTime, 0);
  const delayStr = s.depDelay > 0 ? `<span class="delay">+${s.depDelay} min</span>` : '';
  const platStr  = s.platform ? `Gleis/Bussteig ${escHtml(s.platform)}` : 'k. A.';

  // Perlschnur (leg timeline)
  const legsHtml = trip.legs.map(leg => {
    const isWalk = leg.mode === 'walk';
    const delay = leg.depDelay > 0 ? ` <span class="delay">(+${leg.depDelay} min)</span>` : '';
    return `<li>
      <span class="leg-dot${isWalk ? ' walk' : ''}"></span>
      <div class="leg-info">
        <div class="leg-name">${isWalk ? '🚶 Fußweg' : escHtml(leg.line || leg.mode)} ${escHtml(leg.dest)}</div>
        <div class="leg-detail">${escHtml(leg.fromName)} → ${escHtml(leg.toName)} · ${fmtTime(leg.scheduledDep)}${delay}</div>
      </div>
    </li>`;
  }).join('');

  card.innerHTML = `
    <div class="result-card__header">
      <span class="result-card__line">${escHtml(s.line || '–')}</span>
      <span class="result-card__dest">nach ${escHtml(s.dest || s.to || '–')}</span>
    </div>
    <div class="result-card__body">
      <div class="result-card__stat">
        <span class="material-icons">timer</span>
        <span>Abfahrt in <strong>${minUntil}</strong> min ${delayStr}</span>
      </div>
      <div class="result-card__stat">
        <span class="material-icons">train</span>
        <span>${platStr}</span>
      </div>
      <ul class="leg-timeline">${legsHtml}</ul>
    </div>
    <div class="result-card__actions">
      <button class="mdc-button mdc-button--outlined btn-save">
        <span class="material-icons mdc-button__icon">bookmark_add</span>
        <span class="mdc-button__label">Speichern</span>
      </button>
    </div>
  `;

  card.querySelector('.btn-save').addEventListener('click', () => {
    openSaveDialog(trip, searchParams);
  });
  return card;
}

// ---- Save Dialog ----
function openSaveDialog(trip, searchParams) {
  const s = trip.summary || {};
  dialogSummary.textContent = `${s.from || searchParams.originRef} → ${s.to || searchParams.destRef}`;
  dialogName.value = '';
  dialogRecur.value = 'none';
  pendingTrip = { trip, searchParams };
  saveDialog.classList.add('mdc-dialog--open');
}

dialogCancel.addEventListener('click', () => saveDialog.classList.remove('mdc-dialog--open'));
dialogSave.addEventListener('click', async () => {
  if (!pendingTrip) return;
  const { trip, searchParams } = pendingTrip;
  const s = trip.summary || {};
  const id = crypto.randomUUID();
  await saveTrip({
    id,
    name: dialogName.value || `${s.from || searchParams.originRef} → ${s.to || searchParams.destRef}`,
    originRef: searchParams.originRef,
    originType: searchParams.originType,
    destRef: searchParams.destRef,
    destType: searchParams.destType,
    depIso: searchParams.depIso,
    recurrence: dialogRecur.value,
    line: s.line,
    dest: s.dest,
    platform: s.platform,
    createdAt: new Date().toISOString(),
  });
  saveDialog.classList.remove('mdc-dialog--open');
  pendingTrip = null;
  showSnack('Fahrt gespeichert ✓');
});

// ---- Saved Trips ----
btnSaved.addEventListener('click', async () => {
  const trips = await getAllTrips();
  savedList.innerHTML = '';
  sectionResults.classList.add('hidden');
  if (!trips.length) {
    savedList.innerHTML = '<p style="color:#757575">Noch keine Fahrten gespeichert.</p>';
  } else {
    trips.forEach(t => savedList.appendChild(buildSavedCard(t)));
  }
  sectionSaved.classList.remove('hidden');
  sectionSaved.scrollIntoView({ behavior: 'smooth' });
});

function buildSavedCard(t) {
  const card = document.createElement('div');
  card.className = 'saved-card';
  const recurLabel = { none: '', daily: '• Täglich', weekdays: '• Mo–Fr', weekly: '• Wöchentlich' }[t.recurrence] || '';
  card.innerHTML = `
    <span class="material-icons">bookmark</span>
    <div class="saved-card__info">
      <div class="saved-card__name">${escHtml(t.name)}</div>
      <div class="saved-card__detail">${escHtml(t.line || '')} ${recurLabel} · ${fmtTime(t.depIso)}</div>
    </div>
    <div class="saved-card__actions">
      <button title="Jetzt suchen" class="btn-search-saved" data-id="${t.id}">
        <span class="material-icons">search</span>
      </button>
      <button title="Löschen" class="btn-del-saved" data-id="${t.id}">
        <span class="material-icons">delete</span>
      </button>
    </div>
  `;
  card.querySelector('.btn-search-saved').addEventListener('click', () => searchSaved(t));
  card.querySelector('.btn-del-saved').addEventListener('click', async () => {
    await deleteTrip(t.id);
    card.remove();
    showSnack('Fahrt gelöscht.');
  });
  return card;
}

async function searchSaved(t) {
  const depIso = computeNextDep(t);
  btnSearch.disabled = true;
  try {
    const xml = buildTripRequest({
      originRef: t.originRef, originType: t.originType,
      destRef: t.destRef,   destType: t.destType,
      depIso,
    });
    const resp  = await postTrias(xml);
    const trips = parseTripResponse(resp);
    renderResults(trips, { originRef: t.originRef, originType: t.originType, destRef: t.destRef, destType: t.destType, depIso });
  } catch (err) { showSnack('Fehler: ' + err.message); }
  finally { btnSearch.disabled = false; }
}

// ---- Imminent Trip Check (≤ 10 min) ----
async function checkImminentTrips() {
  const trips = await getAllTrips();
  const now = Date.now();
  for (const t of trips) {
    const next = new Date(computeNextDep(t)).getTime();
    if (now >= next - 10 * 60_000 && now <= next + 5 * 60_000) {
      openTripView(t);
      return; // show first matching trip only
    }
  }
}

function openTripView(t) {
  if (activeTripId === t.id) return; // already shown
  activeTripId = t.id;
  tvLine.textContent = t.line || 'Linie –';
  tvDest.textContent = t.dest || '–';
  tvPlatform.textContent = t.platform || 'k. A.';
  updateTripViewCountdown(t);
  tripView.classList.remove('hidden');

  // Refresh live data every 30 s
  clearInterval(tripViewInterval);
  tripViewInterval = setInterval(() => updateTripViewLive(t), 30_000);
}

tvClose.addEventListener('click', () => {
  tripView.classList.add('hidden');
  clearInterval(tripViewInterval);
  activeTripId = null;
});

function updateTripViewCountdown(t) {
  const depMs = new Date(computeNextDep(t)).getTime();
  const minLeft = Math.max(0, Math.round((depMs - Date.now()) / 60000));
  tvMin.textContent = minLeft;
}

async function updateTripViewLive(t) {
  try {
    const depIso = computeNextDep(t);
    const xml = buildTripRequest({
      originRef: t.originRef, originType: t.originType,
      destRef: t.destRef,   destType: t.destType,
      depIso,
    });
    const resp  = await postTrias(xml);
    const trips = parseTripResponse(resp);
    if (trips.length) {
      const s = trips[0].summary || {};
      const minLeft = depInMin(s.depTime, 0);
      tvMin.textContent = minLeft;
      if (s.platform) tvPlatform.textContent = s.platform;
      if (s.depDelay > 0) {
        tvDelay.textContent = s.depDelay;
        tvDelayRow.style.display = 'flex';
      } else {
        tvDelayRow.style.display = 'none';
      }
    }
  } catch (_) { /* silent */ }
}

// ---- Recurrence helper ----
function computeNextDep(t) {
  if (t.recurrence === 'none' || !t.recurrence) return t.depIso;
  const base = new Date(t.depIso);
  const now  = new Date();
  // Align day
  const target = new Date(now);
  target.setHours(base.getHours(), base.getMinutes(), base.getSeconds(), 0);
  if (target <= now) target.setDate(target.getDate() + 1);

  if (t.recurrence === 'weekdays') {
    while (target.getDay() === 0 || target.getDay() === 6)
      target.setDate(target.getDate() + 1);
  } else if (t.recurrence === 'weekly') {
    while (target.getDay() !== base.getDay())
      target.setDate(target.getDate() + 1);
  }
  return target.toISOString();
}

// ---- Utils ----
function showSnack(msg) {
  snackLabel.textContent = msg;
  snackbar.classList.add('mdc-snackbar--open');
  setTimeout(() => snackbar.classList.remove('mdc-snackbar--open'), 3000);
}

function fmtTime(isoStr) {
  if (!isoStr) return '–';
  try {
    return new Date(isoStr).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  } catch { return isoStr; }
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
