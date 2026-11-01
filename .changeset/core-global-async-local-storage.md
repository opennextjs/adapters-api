---
"@opennextjs/core": patch
---

Define the global `AsyncLocalStorage` in the request handler, the server crashed on its first render when the app has no middleware.
