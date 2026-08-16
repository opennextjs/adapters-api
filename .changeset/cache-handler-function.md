---
"@opennextjs/core": minor
---

Add a dedicated cache handler function

The incremental cache, the tag cache and CDN invalidation can now run in their own function, bundled
to `.open-next/cache-function` and reachable over the new `cache` override.

The overrides for that function are configured through a new top level `cacheHandler` option:

```ts
export default {
	default: {
		override: {
			cache: "local",
		},
	},
	cacheHandler: {
		incrementalCache: "s3",
		tagCache: "dynamodb",
	},
} satisfies OpenNextConfig;
```

Three `cache` implementations ship with core: `fetch` (HTTP), `local` (in-process, imports the cache
bundle) and `dummy`. Adapters that do not want the bundle can opt out with `skipCache` in
`buildAdapter`.

This is additive: the existing `default.override.incrementalCache` and `default.override.tagCache`
keep working unchanged.
