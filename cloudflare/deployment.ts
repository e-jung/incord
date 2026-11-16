import { jesklabs } from './adapters/jesklabs';

/** Public deployment settings; secrets remain Worker bindings. */
export interface DeploymentEnv {
  APP_ORIGIN?: string;
  DEPLOYMENT_ADAPTER?: string;
  ACCOUNTS_ORIGIN?: string;
  ACCOUNTS_CLIENT?: string;
  EMAIL_FROM?: string;
  FEEDBACK_TO?: string;
  VAPID_SUBJECT?: string;
}
export function deployment(env: DeploymentEnv) {
  if (env.DEPLOYMENT_ADAPTER && env.DEPLOYMENT_ADAPTER !== 'jesklabs')
    throw new Error('Unknown deployment adapter');
  const adapter =
    env.DEPLOYMENT_ADAPTER === 'jesklabs' || env.APP_ORIGIN === jesklabs.appOrigin
      ? jesklabs
      : undefined;
  const accountsOrigin = env.ACCOUNTS_ORIGIN || adapter?.accountsOrigin;
  if (
    accountsOrigin &&
    (new URL(accountsOrigin).origin !== accountsOrigin || !accountsOrigin.startsWith('https://'))
  )
    throw new Error('ACCOUNTS_ORIGIN must be an HTTPS origin');
  return {
    accountsOrigin,
    accountsClient: env.ACCOUNTS_CLIENT || 'incord',
    emailFrom: env.EMAIL_FROM || adapter?.emailFrom,
    feedbackTo: env.FEEDBACK_TO || adapter?.feedbackTo,
    vapidSubject: env.VAPID_SUBJECT || adapter?.vapidSubject || '',
    migration: adapter
      ? { origin: adapter.appOrigin, legacyOrigin: adapter.legacyOrigin }
      : undefined,
  };
}
