import { describe, it, expect } from 'vitest';
import { loadPopup } from './popup-sandbox.js';

describe('isAllowedBackendUrl', () => {
  const ctx = loadPopup();

  it('allows https URLs', () => {
    expect(ctx.isAllowedBackendUrl(new URL('https://api.example.com'))).toBe(true);
  });

  it('allows plain http on localhost', () => {
    expect(ctx.isAllowedBackendUrl(new URL('http://localhost:3001'))).toBe(true);
  });

  it('allows plain http on 127.0.0.1', () => {
    expect(ctx.isAllowedBackendUrl(new URL('http://127.0.0.1:3001'))).toBe(true);
  });

  it('rejects plain http on a non-localhost host - the raw PAT would go over the wire in the clear', () => {
    expect(ctx.isAllowedBackendUrl(new URL('http://api.example.com'))).toBe(false);
  });

  it('rejects plain http on an IP address that only looks internal (not actually localhost)', () => {
    expect(ctx.isAllowedBackendUrl(new URL('http://192.168.1.10:3001'))).toBe(false);
  });
});
