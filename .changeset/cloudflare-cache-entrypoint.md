---
"@opennextjs/cloudflare": patch
---

Add the `OpenNextCache` named entrypoint

The build now emits the OpenNext cache handler function and exposes it from the worker as the
`OpenNextCache` named entrypoint, together with a `service-cache` override that reaches it over a
service binding.

This requires a self referencing service binding in the wrangler configuration:

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

Nothing selects this override yet - `defineCloudflareConfig` still runs the cache in the server
function.
