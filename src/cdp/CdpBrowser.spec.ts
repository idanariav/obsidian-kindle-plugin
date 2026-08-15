import { extractDevToolsUrl } from './CdpBrowser';

describe('extractDevToolsUrl', () => {
  it('extracts the websocket URL from a normal Chrome stderr line', () => {
    const stderr = 'DevTools listening on ws://127.0.0.1:54321/devtools/browser/abc-123\n';
    expect(extractDevToolsUrl(stderr)).toBe('ws://127.0.0.1:54321/devtools/browser/abc-123');
  });

  it('returns undefined when no DevTools line is present', () => {
    expect(extractDevToolsUrl('some unrelated output')).toBeUndefined();
  });

  it('finds the line even when preceded by other output', () => {
    const stderr = 'Opening in existing browser session.\nDevTools listening on ws://localhost:1/x\n';
    expect(extractDevToolsUrl(stderr)).toBe('ws://localhost:1/x');
  });
});
