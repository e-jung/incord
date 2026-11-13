# Fix-2 App integration API (store/account child)

Store exports ready for App:
- `addItems(existing, incoming, collection?)` returns unique sorted records, revives tombstones/reset progress. Assign `data.items = addItems(...)`. `findLiveItem(items,id)` ignores deleted records; use for every practice/load lookup.
- `sortItems(items)` canonical Bible order, question number/order fallback; mergeItems also sorts.
- `data.account` is persisted in IndexedDB. Restore `account = data.account || null` on startup before remote calls. `cacheAccount(data, account)` persists identity. Call after every sign-in and successful /me. Fetch /config independently of /me so config failure never blocks identity refresh.
- `installReconnectSync(callback)` installs online/focus/visible listeners and returns cleanup; callback should refresh /me as appropriate and flush sync even if config failed.
- `persist` stamps changed settings fields automatically using last saved snapshot. REMOVE unconditional `settings.updatedAt=Date.now()` from save. IMPORTANT: because App passes a detached `$state.snapshot`, assign returned settings back: `data.settings = await persist($state.snapshot(data))`, before sync. Otherwise the sync payload misses the newly stamped field clocks. `mergeSettings(local, remote)` merges per field; use instead of record-wide replacement.
- `clearStore()` returns persisted fresh LocalState with account=null and no items/history. Assign result on signout/delete AFTER required confirm. Signed-in local merge prompt: do NOT sync before choice; Add = retain current local data and cache new account; Keep separate = second confirm then clearStore(), cache new account, sync. Incoming account settings should be merged before first sync so device defaults do not erase account preferences.
- POST `/api/auth/logout-everywhere` revokes all cookies including current; normal sign-in preserves other devices. Clear local state after success.
- GET `/api/me` signed out/expired/deleted returns 200 `{user:null}` (not 401). Clear cached account when online me definitively returns null; network errors must retain cached identity.

Server validates timeZone and per-field clocks, trims names consistently for /me and export.
