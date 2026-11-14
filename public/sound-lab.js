import { KEY_SAMPLES, DEFAULT_KEY_SAMPLE } from '/audio/keyboard-samples.js';
let context, noise;
const cache = new Map();
const status = document.querySelector('#status');
function audio() {
  if (!context) {
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch { /* Optional API. */ }
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('Audio is unavailable in this browser.');
    context = new Audio();
  }
  // Synchronous gesture unlock, including WebKit versions that need a source
  // start before the resume promise resolves.
  const resume = context.resume();
  const silent = context.createBufferSource();
  silent.buffer = context.createBuffer(1, 1, context.sampleRate);
  silent.connect(context.destination); silent.onended = () => silent.disconnect(); silent.start();
  return resume;
}
function recorded(id) {
  if (!cache.has(id)) cache.set(id, (async () => {
    const response = await fetch(`/audio/${id}.mp3`);
    if (!response.ok) throw new Error('Could not load this sample.');
    return context.decodeAudioData(await response.arrayBuffer());
  })());
  return cache.get(id);
}
function sample(buffer, when) {
  const source = context.createBufferSource(), gain = context.createGain();
  source.buffer = buffer; gain.gain.value = 0.34;
  source.connect(gain); gain.connect(context.destination);
  source.onended = () => { source.disconnect(); gain.disconnect(); };
  source.start(when);
}
function synth(when) {
  if (!noise) {
    noise = context.createBuffer(1, Math.ceil(context.sampleRate * 0.03), context.sampleRate);
    const values = noise.getChannelData(0);
    for (let i = 0; i < values.length; i++) values[i] = Math.random() * 2 - 1;
  }
  const source = context.createBufferSource(), high = context.createBiquadFilter(), low = context.createBiquadFilter();
  const gain = context.createGain(), body = context.createOscillator(), bodyGain = context.createGain();
  source.buffer = noise; high.type = 'highpass'; high.frequency.value = 2000; high.Q.value = 0.707;
  low.type = 'lowpass'; low.frequency.value = 6000; low.Q.value = 0.707;
  gain.gain.setValueAtTime(0, when); gain.gain.linearRampToValueAtTime(0.22, when + 0.001); gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.024);
  body.type = 'sine'; body.frequency.value = 175;
  bodyGain.gain.setValueAtTime(0, when); bodyGain.gain.linearRampToValueAtTime(0.025, when + 0.001); bodyGain.gain.exponentialRampToValueAtTime(0.0001, when + 0.01);
  source.connect(high); high.connect(low); low.connect(gain); gain.connect(context.destination);
  body.connect(bodyGain); bodyGain.connect(context.destination);
  source.onended = () => { for (const node of [source, high, low, gain, body, bodyGain]) node.disconnect(); };
  source.start(when); source.stop(when + 0.024); body.start(when); body.stop(when + 0.01);
}
let latest = 0;
for (const candidate of [...KEY_SAMPLES, { id: 'synth', label: '6 · Current synth reference', source: 'Previous filtered-noise tick + soft sine body' }]) {
  const card = document.createElement('section'); card.className = 'candidate';
  const heading = document.createElement('h2'); heading.textContent = candidate.label + (candidate.id === DEFAULT_KEY_SAMPLE ? ' · app default' : '');
  const description = document.createElement('p'); description.textContent = candidate.source;
  const actions = document.createElement('div'); actions.className = 'actions';
  for (const [count, label] of [[1, 'Single tap'], [5, '5-tap burst']]) {
    const button = document.createElement('button'); button.textContent = label;
    button.setAttribute('aria-label', `${candidate.label}: ${label}`);
    button.addEventListener('click', async () => {
      const token = ++latest;
      try {
        status.textContent = 'Loading…';
        const unlocked = audio();
        const [, buffer] = await Promise.all([unlocked, candidate.id === 'synth' ? undefined : recorded(candidate.id)]);
        if (token !== latest) return;
        if (context.state !== 'running') throw new Error('Audio is blocked. Tap again to retry.');
        const start = context.currentTime;
        for (let i = 0; i < count; i++) buffer ? sample(buffer, start + i * 0.09) : synth(start + i * 0.09);
        status.textContent = `${candidate.label} · ${label}. Hear nothing? Check Silent and volume.`;
      } catch (error) { status.textContent = error instanceof Error ? error.message : 'Audio unavailable. Tap again to retry.'; }
    });
    actions.append(button);
  }
  card.append(heading, description, actions); document.querySelector('#candidates').append(card);
}
