# Boat Route Simulator

A browser-based mock boat tracker that sends GPS-like updates to Firebase Realtime Database in the same shape as your ESP8266 receiver.

Live (Vercel): the root redirects to `Simulator/route-simulator.html`.

## Files
- `Simulator/route-simulator.html` — UI with map and controls
- `Simulator/route-simulator.js` — Route logic, Firebase REST writes
- `index.html` — Redirects `/` to the simulator page
- `vercel.json` — Rewrites `/` to the simulator page for Vercel

## How to use
1. Open the simulator page
   - Vercel: `/` (redirects) or `/Simulator/route-simulator.html`
   - Locally: open `Simulator/route-simulator.html`
2. Click the map to add waypoints (min 2)
3. Set speed (km/h) and update interval (s)
4. Press Start to simulate movement
5. Toggle "Send NO_GPS_FIX" to send status without coordinates
6. Use "🚨 Send Emergency" or the toggle to POST/PUT alerts to Firebase

## Firebase format
- Boat position: PUT `/boats/{boatId}.json`
```
{
  "boatId": "BOAT_001",
  "timestamp": { ".sv": "timestamp" },
  "lat": 14.599500,
  "lng": 120.984200,
  "status": "GPS_FIX",
  "rssi": -68,
  "snr": 8.1,
  "lastUpdate": { ".sv": "timestamp" }
}
```
- No GPS fix: same payload without `lat`/`lng`, status `NO_GPS_FIX`
- Emergency alerts:
  - POST `/alerts.json`
  - PUT `/alerts/latest.json`
```
{
  "id": "<millis>",
  "boatId": "BOAT_001",
  "message": "EMERGENCY",
  "timestamp": { ".sv": "timestamp" },
  "rssi": -70,
  "snr": 7.5,
  "lat": 14.5995, // optional
  "lng": 120.9842 // optional
}
```

## Notes
- If your Firebase requires auth, paste a token in the Auth box; the simulator appends `?auth=TOKEN` to requests.
- The simulator is static and requires no build step.
