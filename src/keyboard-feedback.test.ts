import { afterEach, describe, expect, it, vi } from 'vitest';
import { createKeyboardFeedback, supportsHaptics } from './keyboard-feedback';
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function fixtures(running = true) {
  let resolveResume!: () => void;
  const resumed = new Promise<void>(resolve => { resolveResume = resolve; });
  const vibrate = vi.fn(), audioSession = { type: 'auto' };
  const oscillators: ReturnType<typeof oscillator>[] = [];
  function oscillator() {
    return { type: '', frequency: { value: 0 }, start: vi.fn(), stop: vi.fn(), connect: vi.fn(), disconnect: vi.fn(), onended: null as (() => void) | null };
  }
  const gains: ReturnType<typeof gain>[] = [];
  function gain() {
    return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  }
  const source = { buffer: null, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), onended: null as (() => void) | null };
  const context = {
    state: running ? 'running' : 'suspended', currentTime: 1, sampleRate: 48000, destination: {},
    resume: vi.fn(() => resumed), close: vi.fn().mockResolvedValue(undefined),
    createOscillator: vi.fn(() => { const node = oscillator(); oscillators.push(node); return node; }),
    createGain: vi.fn(() => { const node = gain(); gains.push(node); return node; }),
    createBuffer: vi.fn(() => ({})), createBufferSource: vi.fn(() => source),
  };
  const Audio = vi.fn(function () { return context; });
  vi.stubGlobal('navigator', { vibrate, audioSession, userAgent: 'Android' });
  vi.stubGlobal('window', { AudioContext: Audio });
  return { vibrate, audioSession, Audio, context, oscillators, gains, source, resume() { context.state = 'running'; resolveResume(); } };
}

function ios() {
  const documentMock = {createElement:vi.fn(),activeElement:{}};
  vi.stubGlobal('document',documentMock);
  vi.stubGlobal('navigator',{userAgent:'iPhone',platform:'iPhone',maxTouchPoints:5});
  return documentMock;
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
describe('optional keyboard feedback', () => {
  it('allocates no audio or haptics when unset/off, including unlock', () => {
    const f = fixtures(), feedback = createKeyboardFeedback();
    feedback.play({}); feedback.play({ keySounds: false, haptics: false }, true);
    feedback.unlockAudioContext({ keySounds: false });
    expect(f.Audio).not.toHaveBeenCalled(); expect(f.vibrate).not.toHaveBeenCalled(); feedback.destroy();
  });
  it('uses an ambient soft triangle, 2ms attack and a lower softer slip', () => {
    const f = fixtures(), feedback = createKeyboardFeedback();
    feedback.play({ keySounds: true }); feedback.play({ keySounds: true }, true);
    expect(f.audioSession.type).toBe('ambient'); expect(f.Audio).toHaveBeenCalledTimes(1);
    expect(f.oscillators.map(node => [node.type, node.frequency.value])).toEqual([['triangle', 520], ['triangle', 280]]);
    expect(f.gains[0].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.3, 1.002);
    expect(f.gains[1].gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.2, 1.002);
    expect(f.oscillators[0].stop).toHaveBeenCalledWith(1.05);
    expect(f.oscillators[1].stop).toHaveBeenCalledWith(1.06);
    feedback.setSettings({ keySounds: false });
    expect(f.oscillators[0].stop).toHaveBeenCalledWith();
    expect(f.oscillators[0].disconnect).toHaveBeenCalled();
    feedback.destroy();
  });
  it('starts the silent unlock synchronously while retaining synchronous key haptics', async () => {
    const f = fixtures(false), feedback = createKeyboardFeedback();
    feedback.unlockAudioContext({ keySounds: true });
    feedback.play({ keySounds: true, haptics: true });
    expect(f.vibrate).toHaveBeenCalledExactlyOnceWith(8);
    expect(f.context.resume).toHaveBeenCalledTimes(2);
    expect(f.context.createOscillator).not.toHaveBeenCalled(); expect(f.source.start).toHaveBeenCalledTimes(1);
    f.resume(); await flush();
    expect(f.context.createBuffer).toHaveBeenCalledWith(1, 1, 48000);
    expect(f.source.start).toHaveBeenCalledTimes(1); expect(f.oscillators[0].start).toHaveBeenCalledWith(1);
    f.source.onended?.(); expect(f.source.disconnect).toHaveBeenCalled();
    feedback.destroy();
  });
  it('cancels pending playback when off, even if re-enabled before resume resolves', async () => {
    const f = fixtures(false), feedback = createKeyboardFeedback();
    feedback.unlockAudioContext({ keySounds: true }); feedback.play({ keySounds: true });
    feedback.setSettings({ keySounds: false }); feedback.setSettings({ keySounds: true });
    f.resume(); await flush();
    expect(f.context.createOscillator).not.toHaveBeenCalled(); expect(f.source.start).toHaveBeenCalledTimes(1);
    feedback.play({ keySounds: true }); expect(f.oscillators).toHaveLength(1); feedback.destroy();
  });
  it('retries on a later gesture even if the first resume hangs forever', async () => {
    const f = fixtures(false), feedback = createKeyboardFeedback();
    f.context.resume.mockImplementationOnce(() => new Promise<void>(() => {}));
    feedback.unlockAudioContext({ keySounds: true });
    expect(f.source.start).toHaveBeenCalledTimes(1);
    feedback.play({ keySounds: true });
    expect(f.context.resume).toHaveBeenCalledTimes(2);
    expect(f.oscillators).toHaveLength(0);
    f.resume(); await flush();
    expect(f.oscillators).toHaveLength(1);
    feedback.destroy();
  });
  it('plays only the latest queued tick once across multiple resume completions', async () => {
    const f = fixtures(false), feedback = createKeyboardFeedback();
    feedback.play({ keySounds: true });
    feedback.play({ keySounds: true }, true);
    feedback.unlockAudioContext();
    expect(f.context.resume).toHaveBeenCalledTimes(3);
    f.resume(); await flush();
    expect(f.oscillators).toHaveLength(1);
    expect(f.oscillators[0].frequency.value).toBe(280);
    feedback.destroy();
  });
  it('drops stale queued ticks instead of playing them after a delayed unlock', async () => {
    const f = fixtures(false), feedback = createKeyboardFeedback();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    feedback.play({ keySounds: true });
    now.mockReturnValue(1101);
    f.resume(); await flush();
    expect(f.oscillators).toHaveLength(0);
    feedback.play({ keySounds: true });
    expect(f.oscillators).toHaveLength(1);
    feedback.destroy();
  });
  it('does not replay a queued tick after a newer running-context tick', async () => {
    const f = fixtures(false), feedback = createKeyboardFeedback();
    feedback.play({ keySounds: true });
    f.resume();
    feedback.play({ keySounds: true }, true);
    await flush();
    expect(f.oscillators).toHaveLength(1);
    expect(f.oscillators[0].frequency.value).toBe(280);
    feedback.destroy();
  });
  it('does not play while suspended after a failed resume or after destruction', async () => {
    const f = fixtures(false), feedback = createKeyboardFeedback();
    f.context.resume.mockRejectedValueOnce(new Error('blocked'));
    feedback.play({ keySounds: true }); await flush(); expect(f.oscillators).toHaveLength(0);
    feedback.play({ keySounds: true }); feedback.destroy(); f.resume(); await flush();
    expect(f.oscillators).toHaveLength(0); expect(f.context.close).toHaveBeenCalledTimes(1);
  });
  it('test buttons bypass disabled preferences without changing them', () => {
    const f = fixtures(), feedback = createKeyboardFeedback();
    feedback.setSettings({}); feedback.testSound(); feedback.testHaptic();
    expect(f.oscillators).toHaveLength(1); expect(f.vibrate).toHaveBeenCalledExactlyOnceWith(8);
    feedback.play({}); expect(f.oscillators).toHaveLength(1); expect(f.vibrate).toHaveBeenCalledTimes(1);
    feedback.destroy();
  });
  it('never scripts a switch click or creates hidden controls for iOS playback/test', () => {
    const document = ios(), focus = document.activeElement, feedback = createKeyboardFeedback();
    feedback.play({haptics:true});feedback.play({haptics:true},true);feedback.testHaptic();
    expect(document.createElement).not.toHaveBeenCalled();expect(document.activeElement).toBe(focus);
    feedback.destroy();
  });
  it('does not require a browser haptics API when unsupported', () => {
    vi.stubGlobal('navigator',{userAgent:'desktop',platform:'Linux',maxTouchPoints:0});
    const feedback=createKeyboardFeedback();expect(()=>feedback.testHaptic()).not.toThrow();
    feedback.destroy();
  });
  it('conservatively offers iOS haptics even without a reflected switch property', () => {
    ios(); expect(supportsHaptics()).toBe(true);
    ios(); expect(supportsHaptics()).toBe(true);
    vi.stubGlobal('navigator', { userAgent: 'Macintosh', platform: 'MacIntel', maxTouchPoints: 5 }); expect(supportsHaptics()).toBe(true);
    vi.stubGlobal('navigator', { userAgent: 'desktop', platform: 'MacIntel', maxTouchPoints: 0 }); expect(supportsHaptics()).toBe(false);
    fixtures(); expect(supportsHaptics()).toBe(true);
  });
});
