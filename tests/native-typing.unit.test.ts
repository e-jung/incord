import {it,expect} from 'vitest';
import {settingsRecord,mergeServerSettings} from '../cloudflare/worker';
it('validates and merges synced typing mode independently',()=>{
 const old={typingMode:'incord',updatedAt:1,fieldUpdatedAt:{typingMode:1}};
 const next=settingsRecord({typingMode:'native',updatedAt:2,fieldUpdatedAt:{typingMode:2}});
 expect(mergeServerSettings(old,next)).toMatchObject({typingMode:'native',fieldUpdatedAt:{typingMode:2}});
 expect(()=>settingsRecord({...next,typingMode:'invalid'})).toThrow('Invalid typing mode');
});
