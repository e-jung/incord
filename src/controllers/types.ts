export type ActionNote = { text: string; error?: boolean };
export type GroupGoalSelection = {
  kind: 'passage' | 'topic' | 'starter' | 'document';
  id: string;
  translation: 'BSB' | 'KJV' | 'WEB' | 'ESV';
  start?: number;
  end?: number;
};
export type GroupAttention = {
  pendingRequests: number;
  prayersToday: number;
  goalsNearlyDone: number;
  groupId?: string;
};
export type Consent = {
  clientName: string;
  clientDomain?: string;
  redirectHost: string;
  redirectIsLoopback: boolean;
  scope: string[];
  handle: string;
};
export type ConnectedApp = {
  id: string;
  clientName: string;
  connectedAt: number;
  lastUsed: number | null;
  scope: string[];
};
