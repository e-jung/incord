/** Product rules are data, shared by practice, Today, and the Worker. */
export const RULES = {
  ladder: { firstStep: 1, lastStep: 4, shortcutFallbackStep: 3, fractions: [0, 1 / 3, 2 / 3, 1] },
  scoring: {
    smallPassageWords: 10,
    smallPassageAllowance: 1,
    allowedFraction: 0.1,
    hardFraction: 0.25,
  },
  gentleReturn: { afterDays: 7, initialCap: 3, rampDays: 7 },
  daily: { normalCap: 10, secondsPerItem: 45 },
  scheduler: { retention: 0.9, maximumInterval: 36500, fuzz: false },
  rhythmOptions: [3, 4, 5, 7],
  defaultRhythm: 4,
} as const;
export const rhythmOptions = RULES.rhythmOptions;
export type WeeklyGoal = (typeof rhythmOptions)[number];
