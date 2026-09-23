---
"@opennextjs/core": major
"@opennextjs/cloudflare": minor
---

Route all caching through the `cache` override

The incremental cache and the tag cache no longer run inside the server function. They run in the
cache handler function, which the server, the middleware and the composable cache reach through the
`cache` override. Tag revalidation - `hasBeenRevalidated`, `writeTags` and CDN invalidation - moves
with them, so `get`, `set` and `revalidateTags` now handle tags transparently.

`incrementalCache` and `tagCache` are removed from `default.override` and from the middleware
override. Configurations that are not created by `defineCloudflareConfig` should move them to the
top level `cacheHandler` option and set `default.override.cache`:

```diff
  default: {
    override: {
-     incrementalCache: "s3",
-     tagCache: "dynamodb",
+     cache: "local",
    },
  },
+ cacheHandler: {
+   incrementalCache: "s3",
+   tagCache: "dynamodb",
+ },
```

`defineCloudflareConfig` is unchanged: it now wires the cache to the `OpenNextCache` entrypoint on
its own.
