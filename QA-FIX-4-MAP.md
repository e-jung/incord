# QA2 fix batch 4

| Finding | Resolution / regression coverage |
| --- | --- |
| N1 | Source-derived canonical keys are persisted on every item, including legacy records. Bible book/chapter/verse; document number/part; own-text creation time. Daily reviews use due time then canonical key. WSC/Heidelberg and own-title regressions in store.test.ts. |
| N2, P1-10, N8 | Exclusive One passage / Separate verses / Chunks of ~4 verses control above results. >150 words defaults to chunks; >500 words always confirms the selected item count, including a single passage. qa2.spec.ts and range regressions. |
| N3 | Per-device passkey registration indicator, signed-in Add a passkey action, one-time post-recovery invitation. Registration attaches to the existing account. qa2.spec.ts exercises recovery and second-device registration. |
| N4 | Global signout confirmation; session-version mismatch produces a one-time signed-out-everywhere notice and clears cached account data. qa2.spec.ts uses two contexts. |
| N5 | HTML Cache-Control preserves existing directives and adds no-transform; enforcing CSP remains unchanged. Cloudflare explicitly documents this as disabling automatic Web Analytics beacon injection: https://developers.cloudflare.com/web-analytics/faq/#my-website-is-proxied-through-cloudflare-but-web-analytics-automatic-setup-is-not-working . Local header/CSP checks cannot verify live edge behavior; no production request/deployment was performed. |
| N6 | HSTS max-age=31536000 on all Worker/static responses, with no includeSubDomains/preload. Static/API/redirect/error unit and real asset binding tests. |
| N7 | Fix-3 inline independent collection options control retained and verified by existing geometry browser regression. |
| N9 | Creed disclosures show Article N and opening text; source labels and bulk add controls say article, never question. qa2.spec.ts. |
| N10 | Added document rows show only the disabled check on the existing 44px add control, no duplicate inline notice. qa2.spec.ts. |
| N11 | Recovery code is the only visible sheet before acknowledgment; ownership consent follows, never uploads before choice. Updated real signup/smoke flows assert sequencing. |
| N12 | Browser WebAuthn errors are caught at the browser boundary: Cancelled, unsupported-browser guidance, or generic actionable fallback. Raw browser exception messages never escape. passkeys.test.ts. |
| N13 | Off-band current words scroll instantly; smooth scrolling is reserved for small visible adjustments. Existing independent component/browser scroll matrix. |
| N14 | Pending signed-in sync queues retry without browser events at 5s, 15s, 60s, then 5-minute intervals. Timer cleanup and queue-empty reset; fake-clock regression. |
| N15 | Practiced-today week letters use background/ink inverse contrast; real computed-color browser contrast assertion >=4.5 in both appearances. |
| N16 | Discover chips, format controls, checkbox rows and text/title controls have 44px minimum heights; existing 44px inline document/options icons retained. Browser geometry assertions. |
| N17 | Only WOFF2 Latin/Latin-ext faces are imported and precached (12 files). Vite drops unreferenced Fontsource faces; generated shell hash changes with font changes. Unit and real SW-cache assertions. |
| N18 | ASSETS fallback disabled; Worker supplies shell only for extensionless HTML navigation. Static and dotfile misses stay 404, including via SW. Client explains missing books and can retry. Unit and real asset/SW/browser tests. |
| N19 | Failed review: Let's relearn this / Starting again with a few words showing / Relearn now / Later. Completed attempt remains saved before sheet. Review regressions. |
| N20 | Shared Sheet has an independently clickable full-screen backdrop. Result/welcome/recovery/preview and confirmation sheets close safely; ownership sheets may be deferred without authorizing uploads and reopened in Account. |
| N21 | Once typing starts titles become one ellipsized line, tap to expand/collapse; <700px viewports use smaller type. qa2.spec.ts short-viewport journey. |

Screenshots: `/home/ubuntu/.openclaw/workspace/reports/bible-memory-20261113/fix-4-screens/`.
Independent cross-family integration review completed. Fixed its four findings: reset preference baselines and sheet state after remote revocation; reject stale/wrong-account passkey enrollment (including in-flight challenges); align history handling with visible sheet order; recognize already-registered device passkeys without leaking browser errors.

No push or deployment.
