/* Flipdeck · Service Worker
   Ziel: Die App startet und zeigt die zuletzt geladenen Daten, auch ohne Netz.
   - App-Hülle (index.html) wird vorgehalten
   - Supabase-Leseanfragen: erst Netz, sonst letzter bekannter Stand
   - Produktbilder aus dem Storage: erst Cache (spart Datenvolumen)
   - Schreibvorgänge werden NICHT abgefangen: ohne Netz schlagen sie fehl,
     statt so zu tun, als wäre gespeichert worden.
*/
const VERSION    = "flipdeck-v33";   // v33 (App v5.11.0): Rückgabefristen-Kalender im Dashboard + iPhone-Export (.ics)
const SHELL      = `${VERSION}-shell`;
const DATA       = `${VERSION}-data`;
const IMAGES     = `${VERSION}-img`;

const SHELL_FILES = ["./", "./index.html", "./app.js"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(SHELL)
      .then(c => c.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())   // Precache-Fehler darf die Installation nicht killen
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !k.startsWith(VERSION)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

const isSupabaseRest    = url => url.pathname.includes("/rest/v1/");
const isSupabaseStorage = url => url.pathname.includes("/storage/v1/object/");

self.addEventListener("fetch", e => {
  const req = e.request;
  const url = new URL(req.url);

  // Schreibvorgänge (POST/PATCH/DELETE) und Auth: nie cachen, nie vortäuschen
  if (req.method !== "GET") return;
  if (url.pathname.includes("/auth/v1/")) return;
  // Netz-Proben der App (?ping=…) niemals abfangen/cachen – sonst wächst der Cache zu
  // und die Probe würde aus dem Cache "gelingen", obwohl gar kein Netz da ist.
  if (url.searchParams.has("ping")) return;

  // 1) Seitenaufruf -> Netz, sonst App-Hülle aus dem Cache
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(SHELL).then(c => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html", { ignoreSearch: true })
          .then(r => r || caches.match("./")))
    );
    return;
  }

  // 2) Produktbilder -> erst Cache, dann Netz
  if (isSupabaseStorage(url)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(IMAGES).then(c => c.put(req, copy)); }
        return res;
      }))
    );
    return;
  }

  // 3) Supabase-Daten (lesend) -> erst Netz, bei Ausfall letzter Stand
  if (isSupabaseRest(url)) {
    e.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) { const copy = res.clone(); caches.open(DATA).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || new Response(
          JSON.stringify({ offline: true }),
          { status: 503, headers: { "Content-Type": "application/json" } }
        )))
    );
    return;
  }

  // 4) Alles andere (CDN-Skripte, Schriften) -> Cache, im Hintergrund erneuern
  e.respondWith(
    caches.match(req).then(hit => {
      const net = fetch(req).then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
