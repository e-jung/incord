# Final polish — fix batch 5

- Notifications belong to the originating tab/detail/content screen and expire after 3 seconds. Navigation (including browser Back), opening sheets and entering practice clear them. Async additions cannot notify a different screen. Practice/review never render either notification. A reserved lane above navigation keeps toast surfaces outside the scrollable content's interactive controls.
- Practice has three input rows and one bottom row: Peek, conditional 123/ABC toggle, and a noninteractive "Type first letters" hint. Numeric items swap the three input rows for digit keys; nonnumeric items hide the toggle. All keys are at least 44px tall, and both layouts occupy four rows without the old oversized Peek/digit block. A new item resets the keyboard layout.
- Bulk controls follow the exact item-count threshold: at most 12 items shows only Add all; more than 12 keeps first/next-12 chips. The bundled Apostles' Creed has 12 items; the Nicene Creed actually has 17 generated articles, so it correctly retains the chips under the brief's explicit >12 rule. Content/article segmentation is unchanged.
- New final-polish E2E coverage checks notification lifetime/navigation/practice exclusion and nonoverlap geometry, numeric toggle/input/target heights and equal layout height, and both sides of the document threshold. The shared onscreen typing helper switches 123/ABC before numeric/letter input. The existing short-viewport QA journey now waits for the completed-result sheet before clicking its Close practice button, avoiding a race with the underlying header control.

Evidence: `/home/ubuntu/.openclaw/workspace/reports/bible-memory-20261113/fix-5-screens/`, light and dark iPhone 15 screenshots. Tests generate the screenshots directly, including the previously obscured catechism Step 1 keyboard.

Validation: `npm run check`: 0 errors / 0 warnings; `npm test`: 182/182 across 10 files (100% engine coverage); `npm run e2e`: 106/106; local production smoke (`SMOKE_URL=http://localhost:8793`): 14/14.

24 screenshot files: `iPhone15-{light,dark}-{apostles,catechism-step-1,creed,long-confirm,long-passage,nicene,numeric-digits,numeric-letters,scoped-toast,short-practice,signout-confirm,week-contrast}.png`.

No push or deployment.
