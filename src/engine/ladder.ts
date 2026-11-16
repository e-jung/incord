import { RULES } from '../config/rules';
import { tokenize } from './tokenize';
export type Step = 1 | 2 | 3 | 4;
export type Grade = 'Easy' | 'Good' | 'Hard' | 'Again';

function count(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${name} must be a non-negative integer`);
}
function validStep(step: number): asserts step is Step {
  if (![1, 2, 3, 4].includes(step)) throw new RangeError('step must be 1, 2, 3, or 4');
}

/** Select long words within evenly sized bins. Stable ties favour the bin centre. */
function spread(words: string[], amount: number, mask: boolean[]): void {
  const available = words.map((_, i) => i).filter((i) => !mask[i]);
  for (let bin = 0; bin < amount; bin++) {
    const start = Math.floor((bin * available.length) / amount);
    const end = Math.floor(((bin + 1) * available.length) / amount);
    const center = (start + end - 1) / 2;
    let selected = start;
    for (let j = start + 1; j < end; j++) {
      const length = words[available[j]!]!.length;
      const best = words[available[selected]!]!.length;
      if (length > best || (length === best && Math.abs(j - center) < Math.abs(selected - center)))
        selected = j;
    }
    mask[available[selected]!] = true;
  }
}

/** One boolean per token; true means hidden. Later steps retain earlier hidden words. */
export function maskWords(text: string, step: number): boolean[] {
  validStep(step);
  const words = tokenize(text);
  const mask = words.map(() => step === 4);
  if (step === 1 || step === 4 || !words.length) return mask;
  const target = (s: 2 | 3) =>
    Math.max(1, Math.round(words.length * RULES.ladder.fractions[s - 1]!));
  spread(words, target(2), mask);
  if (step === 3) spread(words, target(3) - target(2), mask);
  return mask;
}

export function allowance(hidden: number): number {
  count(hidden, 'hidden');
  const scoring = RULES.scoring;
  return hidden <= scoring.smallPassageWords
    ? scoring.smallPassageAllowance
    : Math.floor(hidden * scoring.allowedFraction);
}

export function grade(slips: number, hidden: number): Grade {
  count(slips, 'slips');
  const allowed = allowance(hidden);
  if (slips === 0) return 'Easy';
  if (slips <= allowed) return 'Good';
  if (slips <= hidden * RULES.scoring.hardFraction) return 'Hard';
  return 'Again';
}

/**
 * skip on step 1 launches the blank shortcut. Retain skip=true when submitting
 * that step-4 attempt, so a failure falls back to 3 instead of repeating 4.
 * Step 1 type-along never scores memory. A completed blank pass is learned.
 */
export function transition(
  step: number,
  slips: number,
  hidden: number,
  skip = false,
): { step: Step; learned: boolean; passed: boolean } {
  validStep(step);
  count(slips, 'slips');
  const allowed = allowance(hidden);
  if (step === 1) return { step: skip ? 4 : 2, learned: false, passed: true };
  const passed = slips <= allowed;
  if (!passed) return { step: step === 4 && skip ? 3 : step, learned: false, passed: false };
  return { step: Math.min(4, step + 1) as Step, learned: step === 4, passed: true };
}
