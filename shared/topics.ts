export interface TopicMetadata {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly references: string[];
  /** Number of individual verses, including every verse in a range. */
  readonly verseCount: number;
}

/** Curated in reading order; ids also define stable topic-… collection ids. */
export const topics: readonly TopicMetadata[] = [
  {
    id: 'assurance-of-salvation',
    title: 'Assurance of salvation',
    description: 'Rest in Christ’s keeping power and the gift of salvation by grace.',
    references: ['John 10:27–29', 'Romans 8:1', 'Ephesians 2:8–9', '1 John 5:13'],
    verseCount: 7,
  },
  {
    id: 'anxiety-and-peace',
    title: 'Anxiety & peace',
    description: 'Bring your worries to the Father and receive the peace of Christ.',
    references: [
      'Philippians 4:6–7',
      'Isaiah 26:3',
      '1 Peter 5:7',
      'John 14:27',
      'Matthew 6:33–34',
    ],
    verseCount: 7,
  },
  {
    id: 'prayer',
    title: 'Prayer',
    description: 'Learn Jesus’ pattern of prayer and approach God with confidence.',
    references: ['Matthew 6:9–13', '1 John 5:14', 'Hebrews 4:16'],
    verseCount: 7,
  },
  {
    id: 'temptation-and-holiness',
    title: 'Temptation & holiness',
    description: 'Meet temptation with God’s Word and walk by the Spirit.',
    references: ['1 Corinthians 10:13', 'James 1:12–15', 'Psalm 119:11', 'Galatians 5:16'],
    verseCount: 7,
  },
  {
    id: 'suffering-and-hope',
    title: 'Suffering & hope',
    description: 'Look beyond present troubles to the lasting glory God promises.',
    references: ['Romans 5:3–5', 'Romans 8:18', '2 Corinthians 4:16–18'],
    verseCount: 7,
  },
  {
    id: 'identity-in-christ',
    title: 'Identity in Christ',
    description: 'Remember your new life, adoption, and belonging in Christ.',
    references: [
      '2 Corinthians 5:17',
      'Galatians 2:20',
      'Ephesians 1:4–5',
      '1 Peter 2:9',
      'Romans 8:14–15',
    ],
    verseCount: 7,
  },
  {
    id: 'wisdom-and-guidance',
    title: 'Wisdom & guidance',
    description: 'Trust the Lord’s direction and seek the wisdom He gives.',
    references: [
      'Proverbs 3:5–6',
      'James 1:5',
      'Psalm 119:105',
      'Proverbs 16:9',
      'Psalm 32:8',
      'James 3:17',
    ],
    verseCount: 7,
  },
  {
    id: 'gods-character',
    title: "God's character",
    description: 'Know the Lord’s mercy, faithfulness, love, and unchanging goodness.',
    references: ['Exodus 34:6–7', 'Psalm 103:8–10', '1 John 4:8', 'James 1:17'],
    verseCount: 7,
  },
  {
    id: 'great-commission-and-witness',
    title: 'The Great Commission & witness',
    description: 'Carry the good news with courage, gentleness, and confidence in Jesus.',
    references: [
      'Matthew 28:18–20',
      'Acts 1:8',
      'Romans 1:16',
      '1 Peter 3:15',
      '2 Corinthians 5:20',
    ],
    verseCount: 7,
  },
  {
    id: 'verses-for-kids',
    title: 'Verses for kids',
    description: 'Short verses to learn together about God, trust, kindness, and gratitude.',
    references: [
      'Genesis 1:1',
      'Psalm 56:3',
      'Psalm 119:105',
      'Ephesians 4:32',
      '1 Thessalonians 5:16–18',
    ],
    verseCount: 7,
  },
];
