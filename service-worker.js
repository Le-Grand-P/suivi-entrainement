// Service worker : met en cache tous les fichiers de l'appli au premier
// chargement, puis sert tout depuis le cache — l'appli fonctionne ensuite
// intégralement hors ligne, y compris pour importer et analyser un .fit
// (aucune étape ne dépend du réseau). Le nom du cache est versionné : le
// changer force la mise à jour au prochain déploiement.

const CACHE_VERSION = "fit-analyzer-v1";

const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./config.local.js",
  "./css/style.css",
  "./js/app.bundle.js",
  "./js/fit-file-parser.bundle.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-192-maskable.png",
  "./icons/icon-512-maskable.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Cache d'abord, réseau en repli — sauf pour config.local.js qui utilise la
// stratégie inverse (réseau d'abord) : c'est le seul fichier pensé pour être
// modifié après déploiement (édition directe sur GitHub, sans rebuild), donc
// il ne doit jamais rester bloqué sur une version mise en cache tant qu'une
// connexion est disponible. Hors ligne, on retombe sur la dernière version
// connue en cache.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  if (event.request.url.endsWith("/config.local.js")) {
    event.respondWith(
      fetch(event.request)
        .then((fresh) => {
          const copy = fresh.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, copy));
          return fresh;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).catch(() => cached);
    })
  );
});
