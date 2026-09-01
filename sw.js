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
 *  - A SPECIFIC, NAMED allowlist of third-party static-asset CDN hosts
 *    (MapLibre's jsdelivr JS/CSS, Google Fonts) aren't versioned by URL at
 *    all — stale-while-revalidate: serve instantly from cache if present,
 *    but always refresh the cache in the background so a copy never gets
 *    pinned forever.
 *
 * Everything else (any other cross-origin request — the ADS-B relay,
 * OpenRouteService routing/geocoding, MapTiler tiles, adsb.fi's own direct
 * fallback) is deliberately left completely unhandled — no
 * event.respondWith() call at all, so the browser serves it normally.
 *
 * 2026-09-01 bug fix, found from a real reported symptom ("aircraft plots
 * stuck in a loop of ~4 states, occasionally reverting to one from 5-10
 * minutes ago"): this used to be "any cross-origin request" gets
 * stale-while-revalidate, which is correct for the two static CDN assets
 * but was ALSO silently catching the live ADS-B relay call
 * (https://vectair.org/adsb-relay/relay.php?lat=...&lon=...&dist=...) —
 * also cross-origin relative to vectair.github.io. staleWhileRevalidate()
 * returns whatever's already cached for that EXACT URL instantly, with no
 * expiry — so whenever the GPS fix repeated (stationary/slow-moving, or
 * just watchPosition's own maximumAge reusing a fix), the relay URL
 * repeated too, and the service worker handed back a stale aircraft
 * snapshot from Cache Storage instead of live data, sometimes many minutes
 * old. This has nothing to do with relay.php's own short-lived (3s)
 * server-side cache — that's far too brief to explain minutes of
 * staleness; this was purely the browser-side service worker cache having
 * no expiry policy at all for a live-data endpoint it was never meant to
 * touch. Fixed by matching the static-CDN branch against an explicit host
 * allowlist instead of "not this origin" — keep this allowlist in sync
 * with index.html's actual <script>/<link> CDN hosts by hand if either
 * ever changes, same caveat this project already carries for its other
 * intentionally-duplicated config (LOG_ENDPOINT/LOG_ENDPOINT_KEY, etc.).
 *
 * No precache/install-time manifest on purpose — that would need this file
 * regenerated per deploy with an exact file list, real complexity for a
 * "minimal" shell cache. Entries are populated lazily as the app actually
 * requests them, starting from the very first load.
 */

const CACHE_NAME = "vcas-shell-v1";

// Keep in sync with index.html's actual third-party <script>/<link> hosts —
// see the file-level comment above for why this must be a specific
// allowlist, not "any cross-origin request."
const STATIC_CDN_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);

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

  if (STATIC_CDN_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Anything else — the ADS-B relay, ORS routing/geocoding, MapTiler
  // tiles, adsb.fi's own direct fallback — is intentionally left alone:
  // no event.respondWith() call, so the browser handles it as if this
  // service worker didn't exist. See the file-level comment above for why.
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
