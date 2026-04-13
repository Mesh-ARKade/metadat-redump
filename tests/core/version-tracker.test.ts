/**
 * VersionTracker tests
 *
 * @intent Verify VersionTracker handles versions.json read/write correctly
 * @guarantee Handles missing files, creates defaults, tracks timestamps
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('VersionTracker', () => {
  const testVersionsPath = path.join(__dirname, 'fixtures', 'test-versions.json');
  const testDir = path.join(__dirname, 'fixtures');

  beforeEach(async () => {
    // Create fixtures directory
    await fs.mkdir(testDir, { recursive: true }).catch(() => {});
  });

  afterEach(async () => {
    // Clean up test files
    await fs.unlink(testVersionsPath).catch(() => {});
    await fs.rmdir(testDir).catch(() => {});
  });

  describe('read()', () => {
    it('should read existing versions.json', async () => {
      const { VersionTracker } = await import('../../src/core/version-tracker.js');
      const tracker = new VersionTracker(testVersionsPath);

      // Create a test versions file
      await fs.writeFile(
        testVersionsPath,
        JSON.stringify({
          'test-source': { version: '1.0.0', lastChecked: '2026-04-09T00:00:00Z' }
        })
      );

      const result = tracker.read('test-source');

      expect(result).toEqual({
        version: '1.0.0',
        lastChecked: '2026-04-09T00:00:00Z'
      });
    });

    it('should return null for non-existent source', async () => {
      const { VersionTracker } = await import('../../src/core/version-tracker.js');
      const tracker = new VersionTracker(testVersionsPath);

      await fs.writeFile(testVersionsPath, JSON.stringify({}));

      const result = tracker.read('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('write()', () => {
    it('should write version and timestamp for a source', async () => {
      const { VersionTracker } = await import('../../src/core/version-tracker.js');
      const tracker = new VersionTracker(testVersionsPath);

      await tracker.write('test-source', '2.0.0');

      const content = await fs.readFile(testVersionsPath, 'utf-8');
      const data = JSON.parse(content);

      expect(data['test-source']).toBeDefined();
      expect(data['test-source'].version).toBe('2.0.0');
      expect(data['test-source'].lastChecked).toBeDefined();
    });

    it('should preserve existing sources', async () => {
      const { VersionTracker } = await import('../../src/core/version-tracker.js');
      const tracker = new VersionTracker(testVersionsPath);

      // Write initial source
      await tracker.write('existing-source', '1.0.0');

      // Write new source
      await tracker.write('new-source', '2.0.0');

      const content = await fs.readFile(testVersionsPath, 'utf-8');
      const data = JSON.parse(content);

      expect(data['existing-source'].version).toBe('1.0.0');
      expect(data['new-source'].version).toBe('2.0.0');
    });
  });

  describe('getLastChecked()', () => {
    it('should return lastChecked timestamp for a source', async () => {
      const { VersionTracker } = await import('../../src/core/version-tracker.js');
      const tracker = new VersionTracker(testVersionsPath);

      await fs.writeFile(
        testVersionsPath,
        JSON.stringify({
          'test-source': { version: '1.0.0', lastChecked: '2026-04-09T12:00:00Z' }
        })
      );

      const result = tracker.getLastChecked('test-source');

      expect(result).toEqual(new Date('2026-04-09T12:00:00Z'));
    });

    it('should return null for non-existent source', async () => {
      const { VersionTracker } = await import('../../src/core/version-tracker.js');
      const tracker = new VersionTracker(testVersionsPath);

      const result = tracker.getLastChecked('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('file operations', () => {
    it('should handle missing file gracefully', async () => {
      const { VersionTracker } = await import('../../src/core/version-tracker.js');
      const tracker = new VersionTracker('/non/existent/path/versions.json');

      // Should not throw
      const result = tracker.read('any-source');
      expect(result).toBeNull();
    });

    it('should create file if it does not exist on write', async () => {
      const { VersionTracker } = await import('../../src/core/version-tracker.js');
      const tracker = new VersionTracker(testVersionsPath);

      // Ensure file doesn't exist
      await fs.unlink(testVersionsPath).catch(() => {});

      await tracker.write('new-source', '1.0.0');

      const exists = await fs.access(testVersionsPath).then(() => true).catch(() => false);
      expect(exists).toBe(true);
    });
  });
});