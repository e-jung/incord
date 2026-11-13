// Node unit tests never instantiate a Worker entrypoint. OAuth's runtime import
// is used only for an instanceof guard; real entrypoints run in Wrangler E2E.
export class WorkerEntrypoint {}
