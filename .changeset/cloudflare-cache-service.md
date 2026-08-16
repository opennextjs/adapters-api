---
"@opennextjs/cloudflare": minor
---

Move the cache behind a dedicated cache handler function

The incremental cache and the tag cache no longer run inside the server function. They now run in
the cache handler function, bundled to `.open-next/cache-function` as a fetch handler and served by
the worker through the `OpenNextCache` named entrypoint. The server and the middleware reach it over
a service binding.

This requires a new self referencing service binding in the wrangler configuration:

```jsonc
"services": [
  {
    "binding": "NEXT_CACHE_SERVICE",
    "service": "<your-worker-name>",
    "entrypoint": "OpenNextCache"
  }
]
```

The cache runs in the same worker by default. Pointing the binding at another worker is enough to
run the cache as a service of its own.

`defineCloudflareConfig` is otherwise unchanged. Configurations that are not created by
`defineCloudflareConfig` should move `incrementalCache` and `tagCache` from `default.override` to
the new top level `cacheHandler` option, and set `default.override.cache`.
