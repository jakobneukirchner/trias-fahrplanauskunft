// ============================================================
// trias.js – API helper (build request, send, parse response)
// ============================================================

const TRIAS_URL = 'https://v4-api.efa.de/';
const REQUESTOR_REF = '0E67FD30-C2C7-48ED-80DD-D088F7395B14';

/**
 * Build Trias TripRequest XML
 * @param {object} p – {originRef, originType, destRef, destType, depIso, results, algorithm}
 */
export function buildTripRequest(p) {
  const originTag = p.originType === 'stop'
    ? `<StopPointRef>${p.originRef}</StopPointRef><LocationName><Text/></LocationName>`
    : `<AddressRef>${escXml(p.originRef)}</AddressRef>`;
  const destTag = p.destType === 'stop'
    ? `<StopPointRef>${p.destRef}</StopPointRef><LocationName><Text/></LocationName>`
    : `<AddressRef>${escXml(p.destRef)}</AddressRef>`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Trias version="1.2" xmlns="http://www.vdv.de/trias"
  xmlns:ns2="http://www.siri.org.uk/siri"
  xmlns:ns3="http://www.ifopt.org.uk/acsb"
  xmlns:ns4="http://www.ifopt.org.uk/ifopt"
  xmlns:ns5="http://datex2.eu/schema/1_0/1_0">
  <ServiceRequest>
    <ns2:RequestTimestamp>${new Date().toISOString()}</ns2:RequestTimestamp>
    <ns2:RequestorRef>${REQUESTOR_REF}</ns2:RequestorRef>
    <RequestPayload>
      <TripRequest>
        <Origin>
          <LocationRef>${originTag}</LocationRef>
          <DepArrTime>${p.depIso}</DepArrTime>
        </Origin>
        <Destination>
          <LocationRef>${destTag}</LocationRef>
        </Destination>
        <Params>
          <NumberOfResults>${p.results || 5}</NumberOfResults>
          <AlgorithmType>${p.algorithm || 'minChanges'}</AlgorithmType>
          <IncludeFares>true</IncludeFares>
        </Params>
      </TripRequest>
    </RequestPayload>
  </ServiceRequest>
</Trias>`;
}

/**
 * Build Trias LocationInformationRequest XML for autocomplete
 */
export function buildLocationRequest(text) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Trias version="1.2" xmlns="http://www.vdv.de/trias"
  xmlns:ns2="http://www.siri.org.uk/siri">
  <ServiceRequest>
    <ns2:RequestTimestamp>${new Date().toISOString()}</ns2:RequestTimestamp>
    <ns2:RequestorRef>${REQUESTOR_REF}</ns2:RequestorRef>
    <RequestPayload>
      <LocationInformationRequest>
        <InitialInput>
          <LocationName>${escXml(text)}</LocationName>
        </InitialInput>
        <Restrictions>
          <NumberOfResults>8</NumberOfResults>
          <Type>stop</Type>
        </Restrictions>
      </LocationInformationRequest>
    </RequestPayload>
  </ServiceRequest>
</Trias>`;
}

/**
 * POST to Trias endpoint, returns raw XML string
 */
export async function postTrias(xml) {
  const response = await fetch(TRIAS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=UTF-8' },
    body: xml,
  });
  if (!response.ok) throw new Error(`Trias HTTP ${response.status}`);
  return response.text();
}

/**
 * Parse TripResponse XML → array of trip objects
 */
export function parseTripResponse(xmlStr) {
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  const ns = 'http://www.vdv.de/trias';
  const trips = [];

  doc.querySelectorAll('TripResult').forEach(result => {
    const trip = {
      id: getText(result, 'ResultId', ns),
      duration: getText(result, 'Duration', ns),
      legs: [],
    };
    result.querySelectorAll('TripLeg').forEach(leg => {
      const mode = getText(leg, 'PtMode', ns) || getText(leg, 'IndividualMode', ns) || '?';
      const line = getText(leg, 'PublishedLineName', ns) || getText(leg, 'LineName', ns) || '';
      const dest = getText(leg, 'DestinationText', ns) || getText(leg, 'DirectionRef', ns) || '';
      const boardStop = leg.querySelector('LegBoard');
      const alightStop = leg.querySelector('LegAlight');

      const scheduledDep = getText(boardStop, 'TimetabledTime', ns);
      const estimatedDep = getText(boardStop, 'EstimatedTime', ns);
      const scheduledArr = getText(alightStop, 'TimetabledTime', ns);
      const estimatedArr = getText(alightStop, 'EstimatedTime', ns);

      const fromName = getText(boardStop, 'Text', ns);
      const toName   = getText(alightStop, 'Text', ns);
      const platform = getText(boardStop, 'PlannedBay', ns) || getText(boardStop, 'EstimatedBay', ns) || '';

      const depDelay = calcDelayMin(scheduledDep, estimatedDep);

      trip.legs.push({ mode, line, dest, fromName, toName, platform, scheduledDep, estimatedDep, scheduledArr, estimatedArr, depDelay });
    });

    if (trip.legs.length > 0) {
      const first = trip.legs[0];
      trip.summary = {
        line: first.line,
        dest: first.dest,
        from: first.fromName,
        to: trip.legs[trip.legs.length - 1].toName,
        depTime: first.estimatedDep || first.scheduledDep,
        platform: first.platform,
        depDelay: first.depDelay,
      };
    }
    trips.push(trip);
  });
  return trips;
}

/**
 * Parse LocationInformationResponse → array of {name, ref, type}
 */
export function parseLocationResponse(xmlStr) {
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  const locations = [];
  doc.querySelectorAll('Location').forEach(loc => {
    const name = getText(loc, 'Text') || getText(loc, 'LocationName');
    const ref  = getText(loc, 'StopPointRef') || getText(loc, 'AddressRef') || '';
    const type = loc.querySelector('StopPointRef') ? 'stop' : 'address';
    if (name) locations.push({ name, ref, type });
  });
  return locations;
}

// ---- Helpers ----
export function calcDelayMin(scheduled, estimated) {
  if (!scheduled || !estimated) return 0;
  const diff = (new Date(estimated) - new Date(scheduled)) / 60000;
  return Math.round(diff);
}

export function depInMin(depIso, delayMin = 0) {
  const dep = new Date(depIso);
  const now = new Date();
  return Math.round((dep - now) / 60000) + delayMin;
}

function getText(el, tag, ns) {
  if (!el) return '';
  const found = ns ? el.getElementsByTagNameNS(ns, tag)[0] : el.querySelector(tag);
  return found ? found.textContent.trim() : '';
}

function escXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
