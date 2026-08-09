import { describe, it, expect, beforeEach } from 'vitest';
import { tokenStorage } from './auth';

describe('tokenStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no token is stored', () => {
    expect(tokenStorage.getAccess()).toBeNull();
  });

  it('stores and retrieves the access token', () => {
    tokenStorage.setAccess('abc123');
    expect(tokenStorage.getAccess()).toBe('abc123');
    expect(localStorage.getItem('jt_access')).toBe('abc123');
  });

  it('overwrites a previously stored token', () => {
    tokenStorage.setAccess('first');
    tokenStorage.setAccess('second');
    expect(tokenStorage.getAccess()).toBe('second');
  });

  it('clears the stored token', () => {
    tokenStorage.setAccess('abc123');
    tokenStorage.clear();
    expect(tokenStorage.getAccess()).toBeNull();
  });
});
