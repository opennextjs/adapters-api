---
"@opennextjs/core": minor
"@opennextjs/aws": minor
---

Port stale-while-revalidate tag revalidation from AWS

Ports [#1122](https://github.com/opennextjs/opennextjs-aws/pull/1122) and
[#1142](https://github.com/opennextjs/opennextjs-aws/pull/1142).

Tags can now carry `stale` and `expire` durations, so an entry can be served stale while it
revalidates instead of being dropped outright. `writeTags` accepts either a tag name or a
`{ tag, stale, expire }` object, both tag cache flavours gained an optional `isStale`, and the
composable cache handler implements the `updateTags` method added in Next.js 16.

Tag cache overrides that need to deduplicate work within a request can use the new per-request
`requestCache` on the OpenNext request context.
