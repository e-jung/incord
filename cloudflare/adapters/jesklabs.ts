/** Optional maintained-service glue. Never selected by the neutral Wrangler config.
 * Persistent Worker/DO/storage identities are deliberately not configurable here.
 */
export const jesklabs = {
  accountsService: 'jesklabs-accounts',
  accountsEntrypoint: 'IncordClient',
  donateUrl: 'https://ko-fi.com/jesklabs',
  accountsOrigin: 'https://accounts.jesklabs.com',
  appOrigin: 'https://incord.jesklabs.com',
  legacyOrigin: 'https://byheart.jesklabs.com',
  emailFrom: 'Incord <hello@jesklabs.com>',
  feedbackTo: 'incord@jesklabs.com',
  vapidSubject: 'mailto:hello@jesklabs.com',
};
