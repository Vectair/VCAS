/**
 * Minimal app-shell service worker — caching only, no offline "mode".
 *
 * VCAS's core function (live GPS + ADS-B) can't work offline anyway, so
 * this isn't trying to make the app usable offline. What it actually buys:
 * (1) near-instant repeat opens, loading the ~30 app scripts from cache
 * instead of re-fetching them every time, and (2) real hardening against
 * the documented "blank screen / zero interactivity on load" bug (see
 * CLAUDE.md) — that bug happens when one of those scripts hiccups on a
 * fresh network fetch; once they're cached from a prior successful load, a
 * flaky connection on a later open has far less to fail on.
 *
 * Three request classes, three strategies:
 *  - The document itself (navigation requests) has no cache-busting query
 *    and must stay live — network-first, falling back to the last cached
 *    copy only if the network genuinely fails.
 *  - Same-origin assets carrying index.html's own `?v=<build-id>` query
 *    (every local <script>/<link>, stamped by deploy-pages.yml's sed step)
 *    are safe to cache forever: a new deploy is a new URL, automatically a
 *    cache miss. Cache-first.
 *  - Third-party CDN assets (MapLibre, Google Fonts) aren't versioned by
 *    URL at all — stale-while-revalidate: serve instantly from cache if
 *    present, but always refresh the cache in the background so a copy
 *    never gets pinned forever.
 *
 * No precache/install-time manifest on purpose — that would need this file
 * regenerated per deploy with an exact file list, real complexity for a
 * "minimal" shell cache. Entries are populated lazily as the app actually
 * requests them, starting from the very first load.
 */

const CACHE_NAME = "vcas-shell-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  if (req.mode === "navigate") {
    event.respondWith(networkFirst(req));
    return;
  }

  if (url.origin === self.location.origin && url.searchParams.has("v")) {
    event.respondWith(cacheFirst(req));
    return;
  }

  if (url.origin !== self.location.origin) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }
});

async function networkFirst(req) {
  try {
    const fresh = await fetch(req);
    const cache = await caches.open(CACHE_NAME);
    cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const fresh = await fetch(req);
  const cache = await caches.open(CACHE_NAME);
  await cache.put(req, fresh.clone());
  await evictOldVersions(cache, req);
  return fresh;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  const fetchPromise = fetch(req)
    .then((fresh) => {
      cache.put(req, fresh.clone());
      return fresh;
    })
    .catch(() => cached);
  return cached || fetchPromise;
}

/**
 * Same local path, different `?v=` build id — dead weight the instant a
 * new deploy ships, since the HTML never references the old query string
 * again. Trimmed opportunistically so the cache doesn't grow forever,
 * without needing a per-deploy cache-name bump or a real generation-
 * tracking scheme.
 */
async function evictOldVersions(cache, req) {
  const url = new URL(req.url);
  const keys = await cache.keys();
  for (const key of keys) {
    const keyUrl = new URL(key.url);
    if (
      keyUrl.origin === url.origin &&
      keyUrl.pathname === url.pathname &&
      keyUrl.search !== url.search
    ) {
      await cache.delete(key);
    }
  }
}
