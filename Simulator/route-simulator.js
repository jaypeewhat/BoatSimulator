/*
Boat Route Simulator
- Click to add waypoints
- Start to simulate movement along the polyline
- Sends updates to Firebase RTDB in same shape the receiver expects
*/

(function(){
  // --- UI elements ---
  const $ = (id) => document.getElementById(id);
  const dbUrlEl = $("dbUrl");
  const boatIdEl = $("boatId");
  const authEl = $("auth");
  const speedKmhEl = $("speedKmh");
  const intervalSecEl = $("intervalSec");
  const loopEl = $("loopRoute");
  const noFixEl = $("noFix");
  const logEl = $("log");
  const statusEl = $("statusText");
  const btnStart = $("btnStart");
  const btnStop = $("btnStop");
  const btnClear = $("btnClear");
  const btnUndo = $("btnUndo");
  const btnEmergency = $("btnEmergency");
  const emergencyToggle = $("emergencyToggle");
  const btnTogglePanel = $("btnTogglePanel");
  const controlPanel = $("controlPanel");
  const overlayEl = $("overlay");

  // --- Map setup ---
  const map = L.map("map").setView([14.5995, 120.9842], 12); // Manila default
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(map);

  const waypoints = []; // { lat, lng, marker }
  let routeLine = null;
  let boatMarker = null;
  let lastPos = null; // remember last simulated position

  map.on('click', (e) => {
    addWaypoint(e.latlng.lat, e.latlng.lng);
  });

  function addWaypoint(lat, lng){
    const m = L.marker([lat,lng], { draggable: false }).addTo(map);
    waypoints.push({ lat, lng, marker: m });
    drawRoute();
    if (waypoints.length === 1) {
      map.panTo([lat, lng]);
    }
    log(`+ waypoint ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  }

  function removeLastWaypoint(){
    const wp = waypoints.pop();
    if (wp){ map.removeLayer(wp.marker); }
    drawRoute();
    log("↩ removed last waypoint");
  }

  function clearRoute(){
    waypoints.splice(0, waypoints.length).forEach(wp => map.removeLayer(wp.marker));
    if (routeLine){ map.removeLayer(routeLine); routeLine = null; }
    if (boatMarker){ map.removeLayer(boatMarker); boatMarker = null; }
    log("🗑 route cleared");
  }

  function drawRoute(){
    if (routeLine){ map.removeLayer(routeLine); routeLine = null; }
    if (waypoints.length >= 2){
      routeLine = L.polyline(waypoints.map(w => [w.lat, w.lng]), { color: '#38bdf8' }).addTo(map);
      fitBoundsIfNeeded();
    }
  }

  function fitBoundsIfNeeded(){
    const latlngs = waypoints.map(w => [w.lat, w.lng]);
    if (latlngs.length >= 2){
      const bounds = L.latLngBounds(latlngs);
      map.fitBounds(bounds.pad(0.2));
    }
  }

  // --- Simulation state ---
  let simTimer = null;
  let simRunning = false;
  let segIndex = 0; // current segment index (between waypoints[i] -> waypoints[i+1])
  let segProgressMeters = 0; // progress along current segment in meters

  function setStatus(t){ statusEl.textContent = t; }
  function log(t){ const at = new Date().toLocaleTimeString(); logEl.textContent += `\n[${at}] ${t}`; logEl.scrollTop = logEl.scrollHeight; }

  function startSimulation(){
    if (waypoints.length < 2){
      alert('Add at least two waypoints');
      return;
    }
    if (simRunning){ return; }

    simRunning = true;
    segIndex = 0;
    segProgressMeters = 0;

    // Place boat marker at first point
    const a = waypoints[0];
    if (!boatMarker){
      boatMarker = L.circleMarker([a.lat, a.lng], { radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 1 }).addTo(map);
    } else {
      boatMarker.setLatLng([a.lat, a.lng]);
    }

    const intervalMs = Math.max(1, Number(intervalSecEl.value)) * 1000;
    setStatus(`Running @ ${speedKmhEl.value} km/h, every ${intervalSecEl.value}s`);
    log('▶ simulation started');

    // kick first tick immediately
    tickSimulation();
    simTimer = setInterval(tickSimulation, intervalMs);
  }

  function stopSimulation(){
    if (!simRunning){ return; }
    simRunning = false;
    clearInterval(simTimer); simTimer = null;
    setStatus('Paused');
    log('⏸ simulation paused');
  }

  function tickSimulation(){
    if (waypoints.length < 2){ stopSimulation(); return; }

    const speedMs = Math.max(1, Number(speedKmhEl.value)) * (1000/3600); // m/s
    const dt = Math.max(1, Number(intervalSecEl.value)); // s
    let distToAdvance = speedMs * dt; // meters to travel per tick

    while (distToAdvance > 0){
      const i = segIndex;
      const a = waypoints[i];
      const b = waypoints[i+1];
      const segLen = haversine(a.lat, a.lng, b.lat, b.lng);
      const remaining = segLen - segProgressMeters;

      if (distToAdvance < remaining){
        segProgressMeters += distToAdvance;
        distToAdvance = 0;
      } else {
        distToAdvance -= remaining;
        segIndex++;
        segProgressMeters = 0;
        if (segIndex >= waypoints.length - 1){
          if (loopEl.checked){
            segIndex = 0;
          } else {
            // end of route
            stopSimulation();
            setStatus('Arrived (end of route)');
            break;
          }
        }
      }
    }

    // Compute current position on current segment
    const i = segIndex;
    const a = waypoints[i];
    const b = waypoints[i+1];
    const segLen = haversine(a.lat, a.lng, b.lat, b.lng);
    const t = segLen > 0 ? (segProgressMeters / segLen) : 0;
    const pos = interpolate(a.lat, a.lng, b.lat, b.lng, t);
  if (boatMarker){ boatMarker.setLatLng([pos.lat, pos.lng]); }
  lastPos = pos;

    // Emit update to Firebase
    sendToFirebase(pos.lat, pos.lng)
      .then(code => log(`PUT Firebase (${code}) lat=${pos.lat.toFixed(6)} lng=${pos.lng.toFixed(6)}`))
      .catch(err => log(`ERR Firebase ${err}`));
  }

  // --- Geo helpers ---
  function toRad(x){ return x * Math.PI / 180; }
  function haversine(lat1, lon1, lat2, lon2){
    const R = 6371000; // meters
    const dLat = toRad(lat2-lat1);
    const dLon = toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
  function interpolate(lat1, lon1, lat2, lon2, t){ // simple linear in lat/lng
    return { lat: lat1 + (lat2-lat1)*t, lng: lon1 + (lon2-lon1)*t };
  }

  // --- Firebase push (REST) ---
  async function sendToFirebase(lat, lng){
    const base = dbUrlEl.value.replace(/\/$/, '');
    const boatId = boatIdEl.value.trim() || 'BOAT_001';
    const auth = authEl.value.trim();
    let url = `${base}/boats/${encodeURIComponent(boatId)}.json`;
    if (auth) url += `?auth=${encodeURIComponent(auth)}`;

    // Shape matches receiver uploadToFirebase():
    // { boatId, timestamp: {".sv":"timestamp"}, lat?, lng?, status, rssi, snr, lastUpdate: {".sv":"timestamp"} }
    const noFix = noFixEl.checked;
    const payload = {
      boatId,
      timestamp: { ".sv": "timestamp" },
      status: noFix ? 'NO_GPS_FIX' : 'GPS_FIX',
      rssi: -70 + Math.round(Math.random()*10), // mock
      snr: Number((5 + Math.random()*5).toFixed(1)), // mock
      lastUpdate: { ".sv": "timestamp" }
    };
    if (!noFix){
      payload.lat = Number(lat.toFixed(6));
      payload.lng = Number(lng.toFixed(6));
    }

    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return res.status;
  }

  async function sendEmergencyToFirebase(opts = {}){
    // opts: { hasLocation:boolean, lat:number, lng:number }
    const base = dbUrlEl.value.replace(/\/$/, '');
    const boatId = boatIdEl.value.trim() || 'BOAT_001';
    const auth = authEl.value.trim();
    const rssi = -70 + Math.round(Math.random()*10);
    const snr = Number((5 + Math.random()*5).toFixed(1));
    const id = String(Date.now());
    const payload = {
      id,
      boatId,
      message: 'EMERGENCY',
      timestamp: { ".sv": "timestamp" },
      rssi,
      snr
    };
    if (opts.hasLocation && typeof opts.lat === 'number' && typeof opts.lng === 'number'){
      payload.lat = Number(opts.lat.toFixed(6));
      payload.lng = Number(opts.lng.toFixed(6));
    }
    let alertsUrl = `${base}/alerts.json`;
    let latestUrl = `${base}/alerts/latest.json`;
    if (auth){
      alertsUrl += `?auth=${encodeURIComponent(auth)}`;
      latestUrl += `?auth=${encodeURIComponent(auth)}`;
    }
    // 1) Append to alerts log
    const resPost = await fetch(alertsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    // 2) Update latest
    const resPut = await fetch(latestUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    return { post: resPost.status, put: resPut.status };
  }

  // --- Buttons ---
  btnStart.addEventListener('click', startSimulation);
  btnStop.addEventListener('click', stopSimulation);
  btnClear.addEventListener('click', clearRoute);
  btnUndo.addEventListener('click', removeLastWaypoint);
  btnEmergency.addEventListener('click', async () => {
    const hasLoc = !noFixEl.checked && lastPos;
    try {
      const res = await sendEmergencyToFirebase({ hasLocation: !!hasLoc, lat: hasLoc ? lastPos.lat : undefined, lng: hasLoc ? lastPos.lng : undefined });
      log(`🚨 Emergency sent POST=${res.post} PUT=${res.put}${hasLoc ? ` with lat=${lastPos.lat.toFixed(6)} lng=${lastPos.lng.toFixed(6)}` : ' (no location)'}`);
    } catch (e){
      log(`ERR Emergency ${e}`);
    }
  });
  emergencyToggle.addEventListener('change', async () => {
    if (emergencyToggle.checked){
      const hasLoc = !noFixEl.checked && lastPos;
      try {
        const res = await sendEmergencyToFirebase({ hasLocation: !!hasLoc, lat: hasLoc ? lastPos.lat : undefined, lng: hasLoc ? lastPos.lng : undefined });
        log(`🚨 Emergency (toggle) POST=${res.post} PUT=${res.put}${hasLoc ? ` with lat=${lastPos.lat.toFixed(6)} lng=${lastPos.lng.toFixed(6)}` : ' (no location)'}`);
      } catch(e){
        log(`ERR Emergency (toggle) ${e}`);
      } finally {
        emergencyToggle.checked = false; // send once
      }
    }
  });

  // --- Mobile panel toggle ---
  function isMobile(){ return window.matchMedia('(max-width: 900px)').matches; }
  function openPanel(){
    if (!isMobile()) return;
    controlPanel.classList.add('open');
    controlPanel.setAttribute('aria-hidden', 'false');
    if (overlayEl){ overlayEl.hidden = false; overlayEl.classList.add('show'); }
    if (btnTogglePanel){ btnTogglePanel.setAttribute('aria-expanded', 'true'); }
    // Wait for CSS transition, then fix Leaflet map sizing
    setTimeout(() => { try { map.invalidateSize(); } catch(_){} }, 300);
  }
  function closePanel(){
    if (!isMobile()) return;
    controlPanel.classList.remove('open');
    controlPanel.setAttribute('aria-hidden', 'true');
    if (overlayEl){ overlayEl.classList.remove('show'); setTimeout(() => { overlayEl.hidden = true; }, 200); }
    if (btnTogglePanel){ btnTogglePanel.setAttribute('aria-expanded', 'false'); }
    setTimeout(() => { try { map.invalidateSize(); } catch(_){} }, 300);
  }
  if (btnTogglePanel){
    btnTogglePanel.addEventListener('click', () => {
      const open = controlPanel.classList.contains('open');
      if (open) closePanel(); else openPanel();
    });
  }
  if (overlayEl){ overlayEl.addEventListener('click', closePanel); }
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  // Handle responsive changes
  const mq = window.matchMedia('(max-width: 900px)');
  function handleMedia(){
    if (mq.matches){ // mobile
      controlPanel.classList.remove('open');
      controlPanel.setAttribute('aria-hidden', 'true');
      if (overlayEl){ overlayEl.classList.remove('show'); overlayEl.hidden = true; }
      if (btnTogglePanel){ btnTogglePanel.setAttribute('aria-expanded', 'false'); }
    } else { // desktop
      controlPanel.classList.remove('open');
      controlPanel.setAttribute('aria-hidden', 'false');
      if (overlayEl){ overlayEl.classList.remove('show'); overlayEl.hidden = true; }
      if (btnTogglePanel){ btnTogglePanel.setAttribute('aria-expanded', 'false'); }
      try { map.invalidateSize(); } catch(_){}
    }
  }
  mq.addEventListener ? mq.addEventListener('change', handleMedia) : mq.addListener(handleMedia);
  handleMedia();

})();
