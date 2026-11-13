import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeyboardFeedback, supportsHaptics } from './keyboard-feedback';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
function fixtures() {
 const vibrate=vi.fn(); const resume=vi.fn().mockResolvedValue(undefined);
 const frequency={value:0}, start=vi.fn(), stop=vi.fn();
 const oscillator={frequency,start,stop,connect:vi.fn(),disconnect:vi.fn(),onended:null};
 const gain={gain:{setValueAtTime:vi.fn(),exponentialRampToValueAtTime:vi.fn()},connect:vi.fn(),disconnect:vi.fn()};
 const Audio=vi.fn(function(){return {state:'suspended',resume,currentTime:1,destination:{},createOscillator:()=>oscillator,createGain:()=>gain,close:vi.fn().mockResolvedValue(undefined)}});
 vi.stubGlobal('navigator',{vibrate,userAgent:'Android'});vi.stubGlobal('window',{AudioContext:Audio});
 return {vibrate,Audio,frequency,resume,start,stop};
}
describe('optional keyboard feedback',()=>{
 it('does not create audio or vibrate when unset or switched off',()=>{const f=fixtures(),feedback=createKeyboardFeedback();feedback.play({});feedback.play({keySounds:false,haptics:false},true);expect(f.Audio).not.toHaveBeenCalled();expect(f.vibrate).not.toHaveBeenCalled();feedback.destroy()});
 it('creates/resumes audio on a key gesture, uses a softer low slip tone, and honors off instantly',()=>{const f=fixtures(),feedback=createKeyboardFeedback();expect(f.Audio).not.toHaveBeenCalled();feedback.play({keySounds:true});expect(f.frequency.value).toBe(600);feedback.play({keySounds:true},true);expect(f.frequency.value).toBe(330);expect(f.Audio).toHaveBeenCalledTimes(1);expect(f.resume).toHaveBeenCalled();expect(f.stop).toHaveBeenCalledWith(1.04);feedback.play({keySounds:false});expect(f.start).toHaveBeenCalledTimes(2);expect(f.vibrate).not.toHaveBeenCalled();feedback.destroy()});
 it('vibrates only when opted in',()=>{const f=fixtures(),feedback=createKeyboardFeedback();feedback.play({haptics:true});feedback.play({haptics:false});expect(f.vibrate).toHaveBeenCalledExactlyOnceWith(8);expect(f.Audio).not.toHaveBeenCalled();feedback.destroy()});
 it('conservatively offers iOS and iPadOS switch haptics without vibrate',()=>{vi.stubGlobal('navigator',{userAgent:'iPhone',platform:'iPhone',maxTouchPoints:5});expect(supportsHaptics()).toBe(true);vi.stubGlobal('navigator',{userAgent:'Macintosh',platform:'MacIntel',maxTouchPoints:5});expect(supportsHaptics()).toBe(true);vi.stubGlobal('navigator',{userAgent:'desktop',platform:'Linux',maxTouchPoints:0});expect(supportsHaptics()).toBe(false)});
});
