import type { DeploymentEnv } from '../deployment';
import { type AccountsService } from '../accounts';

export interface Env extends DeploymentEnv {
  ACCOUNTS_SVC?: AccountsService;
  ACCOUNTS_GOOGLE?: string;
  ASSETS: Fetcher;
  GROUPS?: DurableObjectNamespace;
  OAUTH_STORAGE: DurableObjectNamespace;
  STATS: DurableObjectNamespace;
  STATS_TOKEN?: string;
  ESV_API_KEY?: string;
  USERS: DurableObjectNamespace;
  REGISTRY: DurableObjectNamespace;
  SESSION_SECRET: string;
  APP_ORIGIN?: string;
  DONATE_URL?: string;
  RESEND_API_KEY?: string;
  EMAIL_TEST_SINK?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
}

export type ObjectData = Record<string, unknown>;

export type Row = Record<string, string | number | null>;

export type Session = { uid: string; version: number; exp: number };

export type Challenge = { challenge: string; kind: 'google'; verifier: string; uid?: string };
