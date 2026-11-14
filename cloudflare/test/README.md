# Disposable Accounts E2E harness

Never deploy these files. Production `wrangler.jsonc` does not reference them.

```sh
# Playwright starts/stops the local multi-Worker harness itself.
PLAYWRIGHT_BASE_URL=http://localhost:8893 npx playwright test tests/jesklabs-accounts.spec.ts --project=iPhone15-light
PLAYWRIGHT_BASE_URL=http://localhost:8893 npx playwright test tests/jesklabs-accounts.spec.ts --project=iPhone15-dark
PLAYWRIGHT_BASE_URL=http://localhost:8893 npx playwright test tests/jesklabs-accounts.spec.ts --project=WebKit-iPhone15
# Or run the same harness interactively:
PLAYWRIGHT_BASE_URL=http://localhost:8893 node cloudflare/test/serve.mjs
```

Run projects sequentially. Use a free localhost port; 8793 remains the default.
The generated `.wrangler/jesklabs-e2e.json` copies the real DO bindings/migrations
and asset routes, overrides only the test entrypoint/service/known dummy variables,
and adds local-only fake browser/mailbox routes. No provider calls are made by the
fake. Its six RPC methods implement the v1 `AccountsService` TypeScript interface;
codes, grants, tickets and synthetic profiles are in-memory and disposable.

`tests/accounts-browser.ts` intercepts the public accounts host on **document
navigations only** and proxies it to the local fake through the bound Worker.
Playwright does not route later URLs in one HTTP redirect chain, so each test hop
uses a tiny refresh document to begin a fresh top-level navigation and keep the
public host intercepted. Local Incord APIs, state, PKCE, DOs, sessions and OAuth
consent are real. The automatic `tests/accounts-playwright.ts` fixture installs this transport on
both the test context and independently-created contexts, preserving old email,
code, Groups and MCP coverage and `/api/test/last-code` behavior.

On HTTP loopback, WebKit rejects Secure `__Host-jl_auth`. The test transport carries
the actual server-issued opaque cookie in browser-context-local memory and sends
it with the real callback/pending/confirm requests through Playwright HTTP. It
asserts the original response cookies have no Domain attribute. Nothing changes
production cookie flags or bypasses server validation. Session cookies returned alongside
a challenge clear are installed separately as host-only browser cookies to avoid
WebKit losing duplicate Set-Cookie fields during routing. HTTPS/native Secure-cookie
behavior is not proven by this HTTP transport.
