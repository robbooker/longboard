import { describe, expect, it } from 'vitest';
import { chatComposerLinks } from '../chatComposerLinks';

describe('draft links', () => {
  it('updates as text becomes a valid URL and removes links when text changes', () => {
    expect(chatComposerLinks('https://')).toEqual([]);
    expect(chatComposerLinks('Read https://example.com/report.')).toEqual([{ href: 'https://example.com/report', label: 'https://example.com/report' }]);
    expect(chatComposerLinks('Read the report')).toEqual([]);
  });

  it('handles multiline text, surrounding punctuation, HTTP, queries and duplicate links', () => {
    expect(chatComposerLinks('(https://EXAMPLE.com/one?a=1&b=2),\nhttp://example.org/two! https://example.com/one?a=1&b=2')).toEqual([
      { href: 'https://example.com/one?a=1&b=2', label: 'https://EXAMPLE.com/one?a=1&b=2' },
      { href: 'http://example.org/two', label: 'http://example.org/two' },
    ]);
  });

  it('never produces executable or local-file protocol links from hostile pasted text', () => {
    for (const body of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd', '//example.com', 'https://%not-a-host', 'http://[bad]']) {
      expect(chatComposerLinks(body), body).toEqual([]);
    }
    const links = chatComposerLinks('<img src=x onerror=alert(1)> https://example.com/?q=<script>alert(1)</script>');
    expect(links).toEqual([{ href: 'https://example.com/?q=', label: 'https://example.com/?q=' }]);
  });

  it('keeps TradingView and GIF addresses as plain links without media data', () => {
    expect(chatComposerLinks('https://www.tradingview.com/x/G4bHTjTX/ https://media.giphy.com/media/abc/giphy.gif')).toEqual([
      { href: 'https://www.tradingview.com/x/G4bHTjTX/', label: 'https://www.tradingview.com/x/G4bHTjTX/' },
      { href: 'https://media.giphy.com/media/abc/giphy.gif', label: 'https://media.giphy.com/media/abc/giphy.gif' },
    ]);
  });
});
