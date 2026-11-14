import {describe,it,expect} from 'vitest';
import {practiceCharacter} from './native-typing';
import {defaults,mergeSettings,stampSettings} from './store';
describe('native practice typing',()=>{
 it('uses one first letter/number per input commit, ignores punctuation and spaces',()=>{
  expect(practiceCharacter(' Faith hope')).toBe('f');
  expect(practiceCharacter('“God')).toBe('g');expect(practiceCharacter('123')).toBe('1');
  expect(practiceCharacter(' ,.—\n')).toBeUndefined();expect(practiceCharacter('')).toBeUndefined();
 });
 it('defaults to Incord and syncs a mode edit without clobbering another field',()=>{
  expect(defaults.typingMode).toBe('incord');
  const old={...defaults,updatedAt:0,fieldUpdatedAt:{typingMode:0,name:0}};
  const changed=stampSettings({...old,typingMode:'native'},old,100);
  const server=changed;
  expect(server.typingMode).toBe('native');expect(server.fieldUpdatedAt!.typingMode).toBe(100);
  expect(mergeSettings({...old,name:'Eric',fieldUpdatedAt:{typingMode:0,name:200}},server)).toMatchObject({typingMode:'native',name:'Eric'});
 });
});
