# Incord product context

Incord is an offline-first Scripture, historic catechism/creed, and own-text memorization PWA. It serves readers practicing on phones, including installed iPhone PWAs. Signed-out practice remains fully usable; accounts optionally synchronize a library and progress across devices. There are no passwords, ads, or third-party trackers.

## Account surface — Operate

Extend the established quiet, tactile Account settings and shared sheet/button primitives. Keep light/dark token styling, readable text, comfortably tappable controls, and form fields of at least 16px. Action feedback belongs beside its control. Do not redesign unrelated surfaces.

Email-free code accounts offer three kid-safe words and four digits. Creation requires a Save your sign-in code sheet with Copy, Share, Print/Save-as-card and explicit saved-code acknowledgment before continuation. Returning readers can sign in with case-insensitive, optionally hyphenless input. Server storage is HMAC-only; a device-only saved copy may be revealed after a tap. Regeneration invalidates the previous code; removal requires another sign-in method. Lost codes cannot be recovered without another linked method. Code-only accounts receive a calm, 30-day-dismissable suggestion to add email or Google. Existing account identity, library, Groups, and MCP connections must remain intact when linking methods.

## Quality bar

Preserve incumbent hierarchy and visual identity. Verify the signed-out entry, save sheet, hidden/revealed code, regeneration, and print card at 320px and 393px in light/dark. Required acknowledgment remains adjacent to its checkbox and blocks Continue until checked. Normal printing must not unexpectedly print credentials. See AGENTS.md for security and lifecycle contracts, README.md for operation, and public/privacy.html for reader-facing privacy details.
