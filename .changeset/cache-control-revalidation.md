---
"@opennextjs/core": patch
---

Derive revalidation from `Cache-Control` on cache entries

The cache handler function now parses the `Cache-Control` of an entry to decide whether it is fresh,
stale or expired, instead of relying on the revalidation timestamp alone. `s-maxage`,
`stale-while-revalidate` and `must-revalidate` are honoured, and the resulting state is carried back
to the caller in the response headers.

The `fetch` and `local` cache overrides also forward the cache type when writing an entry.
Incremental caches that key entries on the type were writing them where `get` does not look.
