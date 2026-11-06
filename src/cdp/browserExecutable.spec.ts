import { candidatesForPlatform } from './browserExecutable';

describe('candidatesForPlatform', () => {
  it('returns mac candidates for darwin', () => {
    const candidates = candidatesForPlatform('darwin');
    expect(candidates.some((c) => c.includes('Google Chrome.app'))).toBe(true);
  });

  it('includes Arc on darwin', () => {
    const candidates = candidatesForPlatform('darwin');
    expect(candidates.some((c) => c.includes('Arc.app'))).toBe(true);
  });

  it('includes Dia on darwin', () => {
    const candidates = candidatesForPlatform('darwin');
    expect(candidates.some((c) => c.includes('Dia.app'))).toBe(true);
  });

  it('returns windows candidates for win32', () => {
    const candidates = candidatesForPlatform('win32');
    expect(candidates.some((c) => c.includes('chrome.exe'))).toBe(true);
  });

  it('returns linux candidates for any other platform', () => {
    const candidates = candidatesForPlatform('linux');
    expect(candidates.some((c) => c.includes('google-chrome'))).toBe(true);
  });

  it('every platform returns at least one candidate', () => {
    for (const platformId of ['darwin', 'win32', 'linux']) {
      expect(candidatesForPlatform(platformId).length).toBeGreaterThan(0);
    }
  });
});
