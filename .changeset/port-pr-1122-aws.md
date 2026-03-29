---
"@opennextjs/aws": patch
---

Ported PR #1122 from source repository

https://github.com/opennextjs/opennextjs-cloudflare/pull/1122

Changed `checkRunningInsideNextjsApp` function signature to accept `{ appPath: string }` instead of full `BuildOptions` object, making it more flexible for use in the migrate command.
