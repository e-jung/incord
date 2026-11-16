import { DEFAULT_KEY_SAMPLE } from '../public/audio/keyboard-samples.js';
export { DEFAULT_KEY_SAMPLE };

/** Each feedback instance owns one context, one download and one decoded sample.
 * Decode/network failures are intentionally silent (never switch to a surprise tone).
 */
export function createKeySampleLoader(context: AudioContext) {
  let pending: Promise<AudioBuffer | undefined> | undefined;
  return () =>
    (pending ??= (async () => {
      try {
        const response = await fetch(`/audio/${DEFAULT_KEY_SAMPLE}.mp3`);
        if (!response.ok) return;
        return await context.decodeAudioData(await response.arrayBuffer());
      } catch {
        return;
      }
    })());
}
