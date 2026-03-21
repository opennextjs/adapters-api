---
"@opennextjs/cloudflare": patch
---

Ported PR #1122 from source repository

https://github.com/opennextjs/opennextjs-cloudflare/pull/1122

Applied bugfixes and improvements to the `migrate` command:
- Fixed extra newlines when appending to files (updated `conditionalAppendFileSync` function signature to use options object with `appendIf` and `appendPrefix`)
- Fixed error when `public` directory is missing (now creates parent directories automatically)
- Fixed Next.js config file update to check if the file exists before attempting to update
