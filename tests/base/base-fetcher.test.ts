/**
 * AbstractFetcher tests
 *
 * @intent Verify AbstractFetcher handles retry, rate-limit, and version checking
 * @guarantee Implements IFetcher with common patterns sources can extend
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DAT } from '../../src/types/index.js';

describe('AbstractFetcher', () => {
  let AbstractFetcher: typeof import('../../src/base/base-fetcher.js').AbstractFetcher;
  let VersionTracker: typeof import('../../src/core/version-tracker.js').VersionTracker;

  const mockDats: DAT[] = [
    { id: '1', source: 'test', system: 'NES', datVersion: '1.0', roms: [] }
  ];

  beforeEach(async () => {
    AbstractFetcher = (await import('../../src/base/base-fetcher.js')).AbstractFetcher;
    VersionTracker = (await import('../../src/core/version-tracker.js')).VersionTracker;
  });

  describe('shouldSkip()', () => {
    it('should return true when remote version matches stored', async () => {
      // Create a concrete fetcher that returns matching versions
      class TestFetcher extends AbstractFetcher {
        async fetchDats(): Promise<DAT[]> {
          return [];
        }
        async checkRemoteVersion(): Promise<string> {
          return '1.0.0';
        }
        getSourceName(): string {
          return 'test-skip-match-' + Date.now();
        }
      }

      const tracker = new VersionTracker('./test-versions.json');
      const sourceName = 'test-skip-match-' + Date.now();
      
      // Write stored version
      await tracker.write(sourceName, '1.0.0');

      const fetcher = new TestFetcher(tracker);
      fetcher.getSourceName = () => sourceName;
      
      const result = await fetcher.shouldSkip();

      expect(result).toBe(true);
    });

    it('should return false when remote version differs from stored', async () => {
      class TestFetcher extends AbstractFetcher {
        async fetchDats(): Promise<DAT[]> {
          return [];
        }
        async checkRemoteVersion(): Promise<string> {
          return '2.0.0';
        }
        getSourceName(): string {
          return 'test-skip-diff-' + Date.now();
        }
      }

      const tracker = new VersionTracker('./test-versions.json');
      const sourceName = 'test-skip-diff-' + Date.now();
      await tracker.write(sourceName, '1.0.0');

      const fetcher = new TestFetcher(tracker);
      fetcher.getSourceName = () => sourceName;
      
      const result = await fetcher.shouldSkip();

      expect(result).toBe(false);
    });
  });

  describe('retry logic', () => {
    it('should retry failed requests', async () => {
      let attempts = 0;
      const sourceName = 'test-retry-' + Date.now();
      
      class TestFetcher extends AbstractFetcher {
        async fetchDats(): Promise<DAT[]> {
          attempts++;
          if (attempts < 3) {
            throw new Error('Temporary failure');
          }
          return mockDats;
        }
        async checkRemoteVersion(): Promise<string> {
          return '1.0.0';
        }
        getSourceName(): string {
          return sourceName;
        }
      }

      const tracker = new VersionTracker('./test-versions.json');
      const fetcher = new TestFetcher(tracker, { maxRetries: 3, retryDelay: 10 });

      const result = await fetcher.fetch();
      
      expect(result).toEqual(mockDats);
      expect(attempts).toBe(3);
    });

    it('should throw after max retries exceeded', async () => {
      const sourceName = 'test-fail-' + Date.now();
      
      class TestFetcher extends AbstractFetcher {
        async fetchDats(): Promise<DAT[]> {
          throw new Error('Permanent failure');
        }
        async checkRemoteVersion(): Promise<string> {
          return '1.0.0';
        }
        getSourceName(): string {
          return sourceName;
        }
      }

      const tracker = new VersionTracker('./test-versions.json');
      const fetcher = new TestFetcher(tracker, { maxRetries: 2, retryDelay: 10 });

      await expect(fetcher.fetch()).rejects.toThrow('Permanent failure');
    });
  });

  describe('rate limiting', () => {
    it('should delay between requests', async () => {
      let lastCallTime = 0;
      let callCount = 0;
      const sourceName = 'test-rate-' + Date.now();
      
      class TestFetcher extends AbstractFetcher {
        async fetchDats(): Promise<DAT[]> {
          const now = Date.now();
          if (callCount > 0) {
            const elapsed = now - lastCallTime;
            // Should have at least 100ms delay between calls
            expect(elapsed).toBeGreaterThanOrEqual(90); // Allow some tolerance
          }
          lastCallTime = now;
          callCount++;
          return [{ id: '1', source: 'test', system: 'NES', datVersion: '1.0', roms: [] }];
        }
        async checkRemoteVersion(): Promise<string> {
          return '1.0.0';
        }
        getSourceName(): string {
          return sourceName;
        }
      }

      const tracker = new VersionTracker('./test-versions.json');
      const fetcher = new TestFetcher(tracker, { rateLimitMs: 100 });

      // Make multiple fetches
      await fetcher.fetch();
      await fetcher.fetch();

      expect(callCount).toBe(2);
    });
  });

  describe('getStoredVersion()', () => {
    it('should return stored version from tracker', async () => {
      class TestFetcher extends AbstractFetcher {
        async fetchDats(): Promise<DAT[]> {
          return [];
        }
        async checkRemoteVersion(): Promise<string> {
          return '2.0.0';
        }
        getSourceName(): string {
          return 'test-fetcher-version-' + Date.now(); // Unique source name
        }
      }

      const tracker = new VersionTracker('./test-versions.json');
      const sourceName = 'test-fetcher-version-' + Date.now();
      await tracker.write(sourceName, '1.5.0');

      const fetcher = new TestFetcher(tracker);
      // Override getSourceName to match what we wrote
      fetcher.getSourceName = () => sourceName;

      const version = fetcher.getStoredVersion();

      expect(version).toBe('1.5.0');
    });

    it('should return null when no stored version', async () => {
      class TestFetcher extends AbstractFetcher {
        async fetchDats(): Promise<DAT[]> {
          return [];
        }
        async checkRemoteVersion(): Promise<string> {
          return '1.0.0';
        }
        getSourceName(): string {
          return 'non-existent-source-' + Date.now(); // Unique non-existent source
        }
      }

      const tracker = new VersionTracker('./test-versions.json');
      const fetcher = new TestFetcher(tracker);

      const version = fetcher.getStoredVersion();

      expect(version).toBeNull();
    });
  });
});