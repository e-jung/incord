# Contributing

Thanks for helping improve Incord. Open a GitHub issue for a bug or idea; discuss substantial changes before investing in a large pull request. Report security issues privately as described in [SECURITY.md](SECURITY.md).

## Local workflow

1. Use Node.js 24, run `npm ci`, and follow [README.md](README.md) for local configuration and Wrangler.
2. Make a focused change. Read [AGENTS.md](AGENTS.md) for persistence, privacy, practice and deployment contracts.
3. Run `npm run check`, `npm test`, `npm run build` and `npm run content:verify`. For UI/account changes, install Playwright browsers and run `npm run e2e` against a fresh local Worker. Add meaningful regression coverage for behavior changes.
4. Submit a pull request describing the problem, solution and checks performed. Include fresh screenshots for visual changes, with no personal data.

Never include secrets, private account data, email codes or copyrighted Bible text. Normal tests use fixtures, not production accounts or live ESV requests. Content changes must follow [content/SOURCES.md](content/SOURCES.md), preserve original editions and commit source/generated changes together.

Keep engine logic DOM-free, UI copy in `src/config`, and styling in the shared tokens/components. Preserve Durable Object identities, additive migrations, offline behavior and explicit device-item ownership.

By submitting a contribution, you agree that your original contribution is provided under this project's AGPL-3.0-only license. Identify any third-party material and its separate license; fonts and public-domain historical texts keep their existing status. No contributor license agreement is required.
