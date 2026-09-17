import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom';
import { clearCache } from '@/lib/requestCache';

// Cleanup after each test.
//
// The request cache is module-level on purpose — every page in the app shares it
// — so it must be reset between tests, or a response cached by one test would be
// served to the next.
afterEach(() => {
  cleanup();
  clearCache();
});

// localStorage backed by a real store, not bare spies.
//
// The session flow genuinely reads back what it writes (token restore, logout),
// so a vi.fn() that always returns undefined would make that behaviour
// untestable. Individual tests can still assert on the calls.
const localStorageStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => (localStorageStore.has(key) ? localStorageStore.get(key)! : null)),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore.set(key, String(value));
  }),
  removeItem: vi.fn((key: string) => {
    localStorageStore.delete(key);
  }),
  clear: vi.fn(() => {
    localStorageStore.clear();
  }),
  key: vi.fn((index: number) => [...localStorageStore.keys()][index] ?? null),
  get length() {
    return localStorageStore.size;
  },
};
global.localStorage = localStorageMock as any;

// Start every test from a clean session.
afterEach(() => {
  localStorageStore.clear();
  localStorageMock.getItem.mockClear();
  localStorageMock.setItem.mockClear();
  localStorageMock.removeItem.mockClear();
});

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  takeRecords() {
    return [];
  }
  unobserve() {}
} as any;
