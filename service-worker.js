/* ═══════════════════════════════════════════════════════════
   SDA LEARNING PLATFORM — SERVICE WORKER
   Hosted on Netlify · App at https://sdalearningplatform.netlify.app/
   ═══════════════════════════════════════════════════════════ */

const CACHE_VERSION = "sda-lms-v1.0.0";

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

/* ═══════════════════════════════════════════════════════════
   INSTALL
   ═══════════════════════════════════════════════════════════ */
self.addEventListener("install", function(event){
  console.log("[SW] Installing:", CACHE_VERSION);

  event.waitUntil(
    caches.open(CACHE_VERSION).then(function(cache){
      return cache.addAll(APP_SHELL).catch(function(err){
        console.warn("[SW] Pre-cache partial failure:", err.message);
      });
    }).then(function(){
      return self.skipWaiting();
    })
  );
});

/* ═══════════════════════════════════════════════════════════
   ACTIVATE
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
    }).then(function(){
      return self.clients.claim();
    })
  );
});

/* ═══════════════════════════════════════════════════════════
   FETCH
   ═══════════════════════════════════════════════════════════ */
self.addEventListener("fetch", function(event){
  const url = new URL(event.request.url);

  /* Only GET */
  if(event.request.method !== "GET") return;

  /* Skip Firebase endpoints — always live */
  if(url.hostname.indexOf("firebaseio.com") !== -1
     || url.hostname.indexOf("googleapis.com") !== -1
     || url.hostname.indexOf("firestore.googleapis.com") !== -1
     || url.hostname.indexOf("gstatic.com") !== -1){
    return;
  }

  /* Skip R2 presign */
  if(url.hostname.indexOf("workers.dev") !== -1
     && url.pathname.indexOf("presign") !== -1){
    return;
  }

  /* Skip Firebase Auth */
  if(url.pathname.indexOf("/__/auth/") !== -1) return;

  /* ── Strategy 1: HTML → Network first, cache fallback ── */
  if(event.request.mode === "navigate"
     || (event.request.headers.get("accept") || "").indexOf("text/html") !== -1){
    event.respondWith(
      fetch(event.request)
        .then(function(response){
          if(response.status === 200){
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(function(cache){
              cache.put(event.request, clone);
            });
          }
          return response;
        })
        .catch(function(){
          return caches.match(event.request)
            .then(function(cached){
              return cached || caches.match("/index.html");
            });
        })
    );
    return;
  }

  /* ── Strategy 2: Static assets → Cache first ── */
  if(url.pathname.match(/\.(png|jpg|jpeg|svg|gif|webp|ico|woff2?|ttf|otf)$/)){
    event.respondWith(
      caches.match(event.request).then(function(cached){
        return cached || fetch(event.request).then(function(response){
          if(response.status === 200){
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(function(cache){
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(function(){ return cached; });
      })
    );
    return;
  }

  /* ── Strategy 3: CSS/JS → Stale-while-revalidate ── */
  if(url.pathname.match(/\.(css|js)$/)){
    event.respondWith(
      caches.match(event.request).then(function(cached){
        const fetchPromise = fetch(event.request).then(function(response){
          if(response.status === 200){
            const clone = response.clone();
            caches.open(CACHE_VERSION).then(function(cache){
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(function(){ return cached; });
        return cached || fetchPromise;
      })
    );
    return;
  }

  /* ── Default: network first, cache fallback ── */
  event.respondWith(
    fetch(event.request)
      .then(function(response){
        if(response.status === 200){
          const clone = response.clone();
          caches.open(CACHE_VERSION).then(function(cache){
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(function(){
        return caches.match(event.request);
      })
  );
});

/* ═══════════════════════════════════════════════════════════
   MESSAGE
   ═══════════════════════════════════════════════════════════ */
self.addEventListener("message", function(event){
  if(event.data && event.data.type === "SKIP_WAITING"){
    self.skipWaiting();
  }
  if(event.data && event.data.type === "CLEAR_CACHE"){
    caches.keys().then(function(keys){
      return Promise.all(keys.map(function(k){ return caches.delete(k); }));
    }).then(function(){
      if(event.ports[0]) event.ports[0].postMessage({ ok: true });
    });
  }
});

console.log("[SW] Loaded:", CACHE_VERSION);