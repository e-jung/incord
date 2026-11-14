import {describe,it,expect,vi,afterEach} from 'vitest';
import {usesHapticOverlay,createNativeActivationGuard} from './haptic-overlay';
const ios={userAgent:'iPhone OS 26_5',platform:'iPhone',maxTouchPoints:5} as Navigator;
describe('trusted-tap overlay eligibility',()=>{
 it('requires enabled haptics and iOS with no vibration API',()=>{
  expect(usesHapticOverlay({},ios)).toBe(false);
  expect(usesHapticOverlay({haptics:false},ios)).toBe(false);
  expect(usesHapticOverlay({haptics:true},ios)).toBe(true);
  expect(usesHapticOverlay({haptics:true},{...ios,vibrate:()=>true} as Navigator)).toBe(false);
 });
 it('supports touch-capable iPad desktop identity, not ordinary Macs or Android',()=>{
  expect(usesHapticOverlay({haptics:true},{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5} as Navigator)).toBe(true);
  expect(usesHapticOverlay({haptics:true},{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:0} as Navigator)).toBe(false);
  expect(usesHapticOverlay({haptics:true},{userAgent:'Android',platform:'Linux',maxTouchPoints:5} as Navigator)).toBe(false);
  expect(usesHapticOverlay({haptics:true},undefined)).toBe(false);
 });
});

describe('native activation lifetime',()=>{
 afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals()});
 function setup(){
  vi.useFakeTimers();const frames:FrameRequestCallback[]=[];
  vi.stubGlobal('requestAnimationFrame',(callback:FrameRequestCallback)=>{frames.push(callback);return frames.length});
  return {guard:createNativeActivationGuard(),frame:()=>frames.shift()!(0)};
 }
 it('dispatches once in a later task and holds DOM moves through the action plus a frame',()=>{
  const {guard,frame}=setup();const events:string[]=[];
  const moveOverlay=vi.fn(()=>events.push('move'));
  guard.defer(()=>{events.push('button');guard.mutate(moveOverlay)},()=>events.push('settled'));
  // A MutationObserver scan/refresh during click dispatch cannot reinsert input.
  guard.mutate(moveOverlay);guard.mutate(moveOverlay);
  expect(events).toEqual([]);expect(moveOverlay).not.toHaveBeenCalled();
  vi.runOnlyPendingTimers();expect(events).toEqual(['button']);expect(moveOverlay).not.toHaveBeenCalled();
  frame();expect(events).toEqual(['button','settled','move']);expect(moveOverlay).toHaveBeenCalledTimes(1);
  vi.runAllTimers();expect(events.filter(event=>event==='button')).toHaveLength(1);
 });
 it('holds reconciliation until every simultaneous activation has settled',()=>{
  const {guard,frame}=setup();const move=vi.fn(),click=vi.fn();
  guard.defer(click);guard.defer(click);guard.mutate(move);vi.runOnlyPendingTimers();
  expect(click).toHaveBeenCalledTimes(2);frame();expect(move).not.toHaveBeenCalled();frame();expect(move).toHaveBeenCalledTimes(1);
  guard.mutate(move);expect(move).toHaveBeenCalledTimes(2);
 });
 it('falls back to a later animation frame if task scheduling is unavailable',()=>{
  const {guard,frame}=setup();const click=vi.fn(),move=vi.fn();
  vi.stubGlobal('setTimeout',()=>{throw Error('unavailable')});
  guard.defer(click);guard.mutate(move);expect(click).not.toHaveBeenCalled();
  frame();expect(click).toHaveBeenCalledTimes(1);expect(move).not.toHaveBeenCalled();
  frame();expect(move).toHaveBeenCalledTimes(1);
 });
});
