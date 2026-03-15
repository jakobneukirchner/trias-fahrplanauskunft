# Fahrplanauskunft Web App

Eine vollständige, mobile-optimierte Fahrplanauskunfts-Web-App basierend auf der **Trias API v1.2** (EFA v4 von hannIT/Connect GmbH) mit Material Design.

## Features

- 🔍 **Verbindungssuche** – Start, Ziel, Abfahrtszeit
- 🚉 **Perlschnur** – Detaillierte Leg-Ansicht mit Umstiegsinformationen
- 🔖 **Gespeicherte Fahrten** – inkl. Wiederholungsregeln (täglich, Mo–Fr, wöchentlich)
- ⏰ **10-Minuten-Reiseansicht** – Öffnet automatisch beim App-Start wenn eine Abfahrt ≤ 10 min bevorsteht
- ⚡ **Live-Updates** – Echtzeit-Verspätungen aus der Trias API
- 📍 **Region-First-Suche** – Braunschweiger Haltestellen werden in der Autovervollständigung bevorzugt
- 📱 **PWA-fähig** – Installierbar, Service Worker, Offline-Cache

## Setup

### Direktstart
Einfach `index.html` in einem lokalen Webserver öffnen (z. B. VS Code Live Server oder `npx serve .`).

### Deploy (Netlify/Vercel)
```bash
npx netlify deploy --dir . --prod
```

## API-Konfiguration

| Parameter | Wert |
|-----------|------|
| Endpoint | `https://v4-api.efa.de/` |
| RequestorRef | `0E67FD30-C2C7-48ED-80DD-D088F7395B14` |
| Limit | 10.000 Aufrufe/Tag |
| Methode | `POST` mit XML-Body (`text/xml`) |

> Bei Überschreitung des Tageslimits: [info@connect-fahrplanauskunft.de](mailto:info@connect-fahrplanauskunft.de)

## Dateistruktur

```
├── index.html        # App Shell (HTML + Material Design)
├── style.css         # Styles (Material Design 2, kein Pink/Lila)
├── app.js            # Hauptlogik: Suche, gespeicherte Fahrten, Trip View
├── trias.js          # Trias API Helper (Request, Parsing)
├── db.js             # IndexedDB Wrapper (gespeicherte Fahrten)
├── sw.js             # Service Worker (Caching + Trip-Check-Trigger)
├── register-sw.js    # SW-Registrierung
└── manifest.json     # Web App Manifest (PWA)
```

## Lokale POIs erweitern

In `app.js` → `LOCAL_POIS`-Array weitere Haltestellen für deine Region hinzufügen:
```js
{ name: 'Braunschweig Neue Haltestelle', ref: 'de:03101:XX', type: 'stop', local: true }
```
Die Haltestellen-IDs (DHID) findest du im VDV-Stammdaten-Portal oder per Trias-LocationInformationRequest.

## Hinweise

- CORS: Die Trias-API erlaubt direkten Browser-Zugriff. Falls nicht, einen kleinen Proxy (z. B. Netlify Function) vorschalten.
- Die App speichert keine Daten auf einem Server – alles lokal im Browser (IndexedDB).
- Material Icons werden via Google Fonts CDN geladen.
