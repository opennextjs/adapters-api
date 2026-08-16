---
"@opennextjs/cloudflare": patch
---

Configure Workers caching per entrypoint

The Next.js server must never be served from the Workers cache, while the `OpenNextCache` entrypoint
returns cacheable responses and should be. Workers caching is now configured per entrypoint, which
requires wrangler `4.107.0` or greater:

```jsonc
"exports": {
  // The Next.js server must not be served from the Workers cache.
  "default": { "type": "worker", "cache": { "enabled": false } },
  // The OpenNext cache entrypoint returns cacheable responses, cache them.
  "OpenNextCache": { "type": "worker", "cache": { "enabled": true } }
}
```
