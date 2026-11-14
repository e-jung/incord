import {describe,it,expect} from 'vitest';
import {usesHapticOverlay} from './haptic-overlay';
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
