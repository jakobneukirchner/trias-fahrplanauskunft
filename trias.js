// trias.js – API helper
const TRIAS_URL = 'https://v4-api.efa.de/';
const REQUESTOR_REF = '0E67FD30-C2C7-48ED-80DD-D088F7395B14';
const NS = 'http://www.vdv.de/trias';

export function buildTripRequest(p) {
  const originInner = p.originType === 'stop'
    ? `<trias:StopPointRef>${p.originRef}</trias:StopPointRef><trias:LocationName><trias:Text> </trias:Text></trias:LocationName>`
    : `<trias:AddressRef>${escXml(p.originRef)}</trias:AddressRef><trias:LocationName><trias:Text>${escXml(p.originRef)}</trias:Text></trias:LocationName>`;
  const destInner = p.destType === 'stop'
    ? `<trias:StopPointRef>${p.destRef}</trias:StopPointRef><trias:LocationName><trias:Text> </trias:Text></trias:LocationName>`
    : `<trias:AddressRef>${escXml(p.destRef)}</trias:AddressRef><trias:LocationName><trias:Text>${escXml(p.destRef)}</trias:Text></trias:LocationName>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<trias:Trias version="1.2"
  xmlns:trias="http://www.vdv.de/trias"
  xmlns:siri="http://www.siri.org.uk/siri">
  <trias:ServiceRequest>
    <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
    <siri:RequestorRef>${REQUESTOR_REF}</siri:RequestorRef>
    <trias:RequestPayload>
      <trias:TripRequest>
        <trias:Origin>
          <trias:LocationRef>
            ${originInner}
          </trias:LocationRef>
          <trias:DepArrTime>${p.depIso}</trias:DepArrTime>
        </trias:Origin>
        <trias:Destination>
          <trias:LocationRef>
            ${destInner}
          </trias:LocationRef>
        </trias:Destination>
        <trias:Params>
          <trias:NumberOfResults>${p.results || 5}</trias:NumberOfResults>
          <trias:AlgorithmType>${p.algorithm || 'minChanges'}</trias:AlgorithmType>
          <trias:IncludeFares>true</trias:IncludeFares>
        </trias:Params>
      </trias:TripRequest>
    </trias:RequestPayload>
  </trias:ServiceRequest>
</trias:Trias>`;
}

export function buildLocationRequest(text) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<trias:Trias version="1.2"
  xmlns:trias="http://www.vdv.de/trias"
  xmlns:siri="http://www.siri.org.uk/siri">
  <trias:ServiceRequest>
    <siri:RequestTimestamp>${new Date().toISOString()}</siri:RequestTimestamp>
    <siri:RequestorRef>${REQUESTOR_REF}</siri:RequestorRef>
    <trias:RequestPayload>
      <trias:LocationInformationRequest>
        <trias:InitialInput>
          <trias:LocationName>${escXml(text)}</trias:LocationName>
        </trias:InitialInput>
        <trias:Restrictions>
          <trias:NumberOfResults>8</trias:NumberOfResults>
        </trias:Restrictions>
      </trias:LocationInformationRequest>
    </trias:RequestPayload>
  </trias:ServiceRequest>
</trias:Trias>`;
}

export async function postTrias(xml) {
  const response = await fetch(TRIAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
    body: xml,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  const text = await response.text();
  // Check for Trias-level error
  if (text.includes('<trias:ErrorMessage>') || text.includes('<ErrorMessage>')) {
    const doc2 = new DOMParser().parseFromString(text, 'application/xml');
    const errEl = doc2.getElementsByTagNameNS(NS, 'Text')[0];
    throw new Error(errEl ? errEl.textContent : 'Trias API Fehler');
  }
  return text;
}

export function parseTripResponse(xmlStr) {
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  const trips = [];

  const results = doc.getElementsByTagNameNS(NS, 'TripResult');
  for (const result of results) {
    const trip = {
      id: nsText(result, 'ResultId'),
      duration: nsText(result, 'Duration'),
      legs: [],
    };

    const legEls = result.getElementsByTagNameNS(NS, 'TripLeg');
    for (const leg of legEls) {
      const timedLeg   = leg.getElementsByTagNameNS(NS, 'TimedLeg')[0];
      const continuousLeg = leg.getElementsByTagNameNS(NS, 'ContinuousLeg')[0];
      const interLeg   = leg.getElementsByTagNameNS(NS, 'InterchangeLeg')[0];

      if (timedLeg) {
        const board  = timedLeg.getElementsByTagNameNS(NS, 'LegBoard')[0];
        const alight = timedLeg.getElementsByTagNameNS(NS, 'LegAlight')[0];
        const service = timedLeg.getElementsByTagNameNS(NS, 'Service')[0];

        const line = nsText(service, 'PublishedLineName') || nsText(service, 'LineName') || '';
        const dest = nsText(service, 'DestinationText') || nsText(service, 'DirectionRef') || '';
        const mode = nsText(service, 'PtMode') || '';
        const fromName = nsText(board,  'StopPointName') || nsText(board, 'Text') || '';
        const toName   = nsText(alight, 'StopPointName') || nsText(alight, 'Text') || '';

        const scheduledDep = nsText(board,  'TimetabledTime');
        const estimatedDep = nsText(board,  'EstimatedTime');
        const scheduledArr = nsText(alight, 'TimetabledTime');
        const estimatedArr = nsText(alight, 'EstimatedTime');
        const platform    = nsText(board,  'PlannedBay') || nsText(board, 'EstimatedBay') || '';
        const depDelay    = calcDelayMin(scheduledDep, estimatedDep);

        trip.legs.push({ type: 'timed', mode, line, dest, fromName, toName, platform, scheduledDep, estimatedDep, scheduledArr, estimatedArr, depDelay });
      } else if (continuousLeg || interLeg) {
        const el = continuousLeg || interLeg;
        const duration = nsText(el, 'Duration') || '';
        trip.legs.push({ type: 'walk', mode: 'walk', line: '', dest: '', fromName: '', toName: '', duration, scheduledDep: '', depDelay: 0 });
      }
    }

    if (trip.legs.length > 0) {
      const firstTimed = trip.legs.find(l => l.type === 'timed');
      const lastTimed  = [...trip.legs].reverse().find(l => l.type === 'timed');
      trip.summary = {
        line:     firstTimed?.line     || '',
        dest:     firstTimed?.dest     || '',
        from:     firstTimed?.fromName || '',
        to:       lastTimed?.toName    || '',
        depTime:  firstTimed?.estimatedDep || firstTimed?.scheduledDep || '',
        arrTime:  lastTimed?.estimatedArr  || lastTimed?.scheduledArr   || '',
        platform: firstTimed?.platform || '',
        depDelay: firstTimed?.depDelay || 0,
      };
    }
    trips.push(trip);
  }
  return trips;
}

export function parseLocationResponse(xmlStr) {
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  const locations = [];
  const locationEls = doc.getElementsByTagNameNS(NS, 'Location');
  for (const loc of locationEls) {
    const nameEl  = loc.getElementsByTagNameNS(NS, 'LocationName')[0];
    const name    = nameEl ? nsText(nameEl, 'Text') : '';
    const spRef   = loc.getElementsByTagNameNS(NS, 'StopPointRef')[0];
    const adrRef  = loc.getElementsByTagNameNS(NS, 'AddressRef')[0];
    const ref     = spRef?.textContent?.trim() || adrRef?.textContent?.trim() || '';
    const type    = spRef ? 'stop' : 'address';
    if (name && ref) locations.push({ name, ref, type });
  }
  return locations;
}

export function calcDelayMin(scheduled, estimated) {
  if (!scheduled || !estimated) return 0;
  return Math.round((new Date(estimated) - new Date(scheduled)) / 60000);
}

export function depInMin(depIso) {
  if (!depIso) return 0;
  return Math.round((new Date(depIso) - Date.now()) / 60000);
}

function nsText(el, tag) {
  if (!el) return '';
  const found = el.getElementsByTagNameNS(NS, tag)[0];
  return found ? found.textContent.trim() : '';
}

function escXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
