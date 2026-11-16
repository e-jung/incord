import { describe, it, expect } from 'vitest';
import { errorReport } from './telemetry';
describe('private client diagnostics', () => {
  it('never serializes user exception text, query strings or foreign stack content', () => {
    const error = new TypeError('private verse and recovery secret');
    error.stack =
      'TypeError: private verse\n at save (https://app.test/assets/index-ABC.js:1:23)\n at private secret (https://foreign.test/?secret)';
    const report = errorReport(error, '/private-title?secret', 'Mozilla Safari');
    expect(report.message).toBe('Unhandled TypeError');
    expect(report.stack).toBe('/assets/index-ABC.js:1:23');
    expect(report.route).toBe('/');
    expect(report.ua).toBe('Safari');
    expect(JSON.stringify(report)).not.toMatch(/secret|private|foreign/);
  });
  it('handles rejection values without coercing private objects', () => {
    expect(errorReport({ text: 'secret' }, '/gallery', 'Chrome').message).toBe('Unhandled Error');
  });
});
