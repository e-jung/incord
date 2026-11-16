import type { Item } from '../store';
import type { GroupAttention, GroupGoalSelection, ConnectedApp } from './types';
export interface AppCommands {
  clearAction: (key: string) => void;
  noteAction: (key: string, text: string, error?: boolean) => void;
  action: (key: string, fn: () => Promise<unknown>, success?: string) => Promise<void>;
  savePreference: (key: string) => Promise<void>;
  signInForGroups: () => void;
  setGroupAttention: (value?: GroupAttention) => void;
  refreshGroupAttention: (force?: boolean) => Promise<void>;
  openGroupAttention: () => void;
  joinedGroup: () => void;
  chooseGroupGoal: (id: string) => void;
  setGroupGoal: (selection: GroupGoalSelection) => Promise<void>;
  loadConsent: () => Promise<void>;
  decideConsent: (decision: 'approve' | 'deny') => Promise<void>;
  googleSignin: (link?: boolean) => void;
  accountsReturn: () => string;
  accountsHop: (params: URLSearchParams) => void;
  primarySignin: () => void;
  loadJlPending: () => Promise<void>;
  confirmJl: () => Promise<void>;
  cancelJl: () => Promise<void>;
  loadConnectedApps: () => Promise<void>;
  revokeApp: (app: ConnectedApp) => Promise<void>;
  initialGroupsRoute: () => boolean;
  filterDiscover: (value: string) => void;
  unlockPractice: () => void;
  feedbackMeta: () => {
    version: string;
    platform: string;
    uaFamily: string;
    viewport: { width: number; height: number };
    signedIn: boolean;
  };
  showFeedbackResult: () => Promise<void>;
  sendFeedback: () => Promise<void>;
  clearToasts: () => void;
  clearTapFeedback: () => void;
  resetAttempt: () => void;
  closePractice: () => void;
  requestClosePractice: () => void;
  focusPractice: () => void;
  undoTap: () => void;
  clearPreviewNotes: () => void;
  resetTranslationResults: () => void;
  changeTranslation: (event: Event) => void;
  theme: () => void;
  save: () => Promise<void>;
  sync: () => Promise<void>;
  attempt: (fn: () => Promise<void>) => Promise<void>;
  pushView: () => void;
  openDiscoverAdd: () => void;
  abandonGroupSignin: (to: string) => void;
  navigate: (to: string) => void;
  openCollection: (id: string) => void;
  add: (
    items: any[],
    collectionId?: string,
    confirmed?: boolean,
    largePassage?: boolean,
    key?: string,
  ) => Promise<boolean>;
  addChecked: (
    items: any[],
    collectionId?: string,
    confirmed?: boolean,
    largePassage?: boolean,
  ) => Promise<true | undefined>;
  confirmBatchAdd: () => Promise<void>;
  previewSelection: (key: string, load: () => Promise<any>) => Promise<void>;
  previewPassage: (id: string) => Promise<void>;
  previewFeatured: (id: string) => Promise<void>;
  previewTopic: (id: string) => Promise<void>;
  previewFound: (source: any) => Promise<void>;
  addStarter: (s: any) => Promise<void>;
  begin: (items: Item[]) => void;
  loadNext: () => Promise<void>;
  key: (key: string) => void;
  physical: (e: KeyboardEvent) => void;
  finish: () => Promise<void>;
  continueResult: () => void;
  refreshIdentity: (user: any, revoked?: boolean) => Promise<void>;
  afterSignin: (syncNow?: boolean) => Promise<void>;
  acceptMerge: () => Promise<void>;
  discardLocal: () => Promise<void>;
  editEmail: () => void;
  sendEmail: () => Promise<void>;
  verifyEmail: () => Promise<void>;
  codeInput: (event: Event) => void;
  codeAccountAction: (kind: 'create' | 'signin' | 'regenerate' | 'remove') => Promise<void>;
  finishSavingCode: () => Promise<void>;
  copyAccountCode: () => Promise<void>;
  shareAccountCode: () => Promise<void>;
  printAccountCode: () => void;
  forgetCodeBackupReminder: () => void;
  setShareCounts: (event: Event) => Promise<void>;
  signout: (everywhere?: boolean) => Promise<void>;
  exportData: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  refreshPush: () => Promise<void>;
  testPush: () => Promise<void>;
  enablePush: () => Promise<void>;
  disablePush: () => Promise<void>;
  search: () => Promise<void>;
  own: () => Promise<void>;
  know: () => void;
  restart: () => void;
  remove: (item: Item) => Promise<void>;
  undo: () => Promise<void>;
  passageItems: () => any[];
}
