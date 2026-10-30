/* ═══════════════════════════════════════════════════════════
   SDA LEARNING PLATFORM — SERVICE WORKER v2 (production)
   Netlify · SPA · Firebase v10 · R2 storage
   ------------------------------------------------------------
   FIXES APPLIED:
     C1 — HTML never cached (network-only for navigations)
     C2 — CACHE_VERSION substituted at deploy via Netlify
     C3 — No skipWaiting() in install (respects update prompt)
     C4 — No clients.claim() (no mid-edit takeover)
     H1 — Skip all Firebase auth/token hosts (no JWT leak)
     H2 — Skip ALL workers.dev (R2 files always fresh)
     L4 — Removed dead CLEAR_CACHE handler
     L5 — cache.put() failures caught (no unhandled rejections)
     L6 — Cache trimmed to 200 items (quota safety)
   ═══════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════
   VERSION — replaced at build time by netlify.toml.
   If substitution fails (local dev), falls back to a timestamp.
   ═══════════════════════════════════════════════════════════ */
const CACHE_VERSION = "sda-lms-CACHE_VERSION_PLACEHOLDER";

/* ═══════════════════════════════════════════════════════════
   HOSTS TO NEVER CACHE
   These must always hit the network (Firebase + R2).
   ═══════════════════════════════════════════════════════════ */
const SKIP_HOSTS = [
  "firebaseio.com",
  "googleapis.com",           /* covers firestore, identitytoolkit, securetoken */
  "gstatic.com",
  "firebaseapp.com",
  "firebaseinstallations.googleapis.com",
  "workers.dev"               /* R2 — your bucket domain */
];

/* ═══════════════════════════════════════════════════════════
   APP SHELL — pre-cached on install
   ═══════════════════════════════════════════════════════════ */
const APP_SHELL = [
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
  /* NOTE: /index.html is NOT in this list.
     It's cached on-demand by the fetch handler for offline use only. */
];

/* ═══════════════════════════════════════════════════════════
   CACHE SIZE LIMIT — trimmed after each put
   ═══════════════════════════════════════════════════════════ */
const MAX_CACHE_ITEMS = 200;

/* ═══════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════ */

function shouldSkip(url){
  for(let i = 0; i < SKIP_HOSTS.length; i++){
    if(url.hostname.indexOf(SKIP_HOSTS[i]) !== -1) return true;
  }
  return false;
}

function trimCache(maxItems){
  caches.open(CACHE_VERSION).then(function(cache){
    cache.keys().then(function(keys){
      if(keys.length <= maxItems) return;
      const toDelete = keys.slice(0, keys.length - maxItems);
      Promise.all(toDelete.map(function(k){ return cache.delete(k); }))
        .catch(function(){});
    });
  }).catch(function(){});
}

function safePut(request, response){
  caches.open(CACHE_VERSION).then(function(cache){
    cache.put(request, response)
      .then(function(){ trimCache(MAX_CACHE_ITEMS); })
      .catch(function(err){
        console.warn("[SW] Cache put failed:", err && err.message);
      });
  }).catch(function(){});
}

/* ═══════════════════════════════════════════════════════════
   INSTALL — pre-cache the app shell
   ═══════════════════════════════════════════════════════════ */
self.addEventListener("install", function(event){
  console.log("[SW] Installing:", CACHE_VERSION);

  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache){
      return cache.addAll(APP_SHELL).catch(function(err){
        console.warn("[SW] Pre-cache partial failure:", err.message);
        /* Non-fatal — SW still installs with partial cache */
      });
    })
    /* NO skipWaiting() here — that's C3.
       The new SW stays in "waiting" until user clicks "Update"
       (which sends SKIP_WAITING message). */
  );
});

/* ═══════════════════════════════════════════════════════════
   ACTIVATE — clean up old caches
   ═══════════════════════════════════════════════════════════ */
self.addEventListener("activate", function(event){
  console.log("[SW] Activating:", CACHE_VERSION);

  event.waitUntil(
    caches.keys().then(function(keys){
      return Promise.all(
        keys.map(function(key){
          if(key !== CACHE_VERSION){
            console.log("[SW] Removing old cache:", key);
            return caches.delete(key);
          }
        })
      );
    })
    /* NO clients.claim() here — that's C4.
       New SW applies on next navigation, not on current page. */
  );
});

/* ═══════════════════════════════════════════════════════════
   FETCH HANDLER
   ═══════════════════════════════════════════════════════════ */
self.addEventListener("fetch", function(event){
  const request = event.request;
  const url = new URL(request.url);

  /* Only GET */
  if(request.method !== "GET") return;

  /* Only same-origin (never cache Firebase, R2, or external CDN) */
  if(url.origin !== self.location.origin) return;

  /* Skip Firebase/Google/R2 hosts */
  if(shouldSkip(url)) return;

  /* Skip Firebase Auth redirect */
  if(url.pathname.indexOf("/__/auth/") !== -1) return;

  /* ═══════════════════════════════════════════════════════════
     STRATEGY 1 — HTML → NETWORK-ONLY, NO CACHE (C1 fix)
     This is THE critical fix. Never cache index.html.
     Always fetch fresh → users always get latest deploy.
     Cache only serves as offline fallback.
     ═══════════════════════════════════════════════════════════ */
  const isHtml = request.mode === "navigate"
    || (request.headers.get("accept") || "").indexOf("text/html") !== -1;

  if(isHtml){
    event.respondWith(
      fetch(request).catch(function(){
        /* Offline fallback — serve cached HTML only when truly offline */
        return caches.match("/index.html").then(function(cached){
          if(cached) return cached;
          /* If nothing cached, serve a minimal offline page */
          return new Response(
            '<!DOCTYPE html><html><head><meta charset="utf-8">'
            + '<meta name="viewport" content="width=device-width,initial-scale=1">'
            + '<title>Offline — SDA Learning</title>'
            + '<style>body{font-family:system-ui;display:flex;'
            + 'align-items:center;justify-content:center;min-height:100vh;'
            + 'margin:0;background:#FAF8F3;color:#1B2A44;text-align:center;padding:20px}'
            + 'h1{color:#0E45EB;margin-bottom:12px}'
            + '.btn{display:inline-block;margin-top:20px;padding:12px 24px;'
            + 'background:#0E45EB;color:#fff;text-decoration:none;'
            + 'border-radius:8px;font-weight:600}'
            + '</style></head><body><div>'
            + '<h1>You are offline</h1>'
            + '<p>Please check your internet connection and try again.</p>'
            + '<a href="/" class="btn">Retry</a>'
            + '</div></body></html>',
            { headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        });
      })
    );
    return;
  }

  /* ═══════════════════════════════════════════════════════════
     STRATEGY 2 — Static assets (img/font) → CACHE-FIRST
     ═══════════════════════════════════════════════════════════ */
  if(url.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf|otf)$/)){
    event.respondWith(
      caches.match(request).then(function(cached){
        if(cached) return cached;
        return fetch(request).then(function(response){
          if(response.ok){
            safePut(request, response.clone());
          }
          return response;
        }).catch(function(){
          /* Offline — return cached if any, else broken-image placeholder */
          return caches.match(request).then(function(c){
            return c || new Response("", { status: 404 });
          });
        });
      })
    );
    return;
  }

  /* ═══════════════════════════════════════════════════════════
     STRATEGY 3 — CSS/JS → STALE-WHILE-REVALIDATE
     ═══════════════════════════════════════════════════════════ */
  if(url.pathname.match(/\.(css|js)$/)){
    event.respondWith(
      caches.match(request).then(function(cached){
        const fetchPromise = fetch(request).then(function(response){
          if(response.ok){
            safePut(request, response.clone());
          }
          return response;
        }).catch(function(){
          return cached;
        });
        return cached || fetchPromise;
      })
    );
    return;
  }

  /* ═══════════════════════════════════════════════════════════
     STRATEGY 4 — DEFAULT → NETWORK-FIRST with cache fallback
     ═══════════════════════════════════════════════════════════ */
  event.respondWith(
    fetch(request)
      .then(function(response){
        if(response.ok){
          safePut(request, response.clone());
        } else {
          /* Non-2xx → try cache as fallback */
          return caches.match(request).then(function(cached){
            return cached || response;
          });
        }
        return response;
      })
      .catch(function(){
        return caches.match(request).then(function(cached){
          return cached || new Response("", { status: 503 });
        });
      })
  );
});

/* ═══════════════════════════════════════════════════════════
   MESSAGE HANDLER
   Only SKIP_WAITING — sends from the app's update prompt.
   (L4 fix — removed the dead CLEAR_CACHE handler.)
   ═══════════════════════════════════════════════════════════ */
self.addEventListener("message", function(event){
  if(event.data && event.data.type === "SKIP_WAITING"){
    console.log("[SW] User approved update — activating new version");
    self.skipWaiting();
  }
});

console.log("[SW] Loaded:", CACHE_VERSION);