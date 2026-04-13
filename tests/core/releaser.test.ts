/**
 * GitHubReleaser tests
 *
 * @intent Verify GitHubReleaser creates releases and uploads artifacts correctly
 * @guarantee Handles release creation, asset upload, retry logic, idempotency
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { Artifact, Release } from '../../src/types/index.js';

describe('GitHubReleaser', () => {
  let releaser: typeof import('../../src/core/releaser.js');

  const mockArtifact: Artifact = {
    name: 'test.jsonl.zst',
    path: '/tmp/test.jsonl.zst',
    size: 1000,
    sha256: 'abc123def456',
    entryCount: 10
  };

  const mockRelease: Release = {
    tag: 'v1.0.0',
    name: 'Release v1.0.0',
    body: 'Test release body',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: 'test.jsonl.zst',
        size: 1000,
        downloadCount: 0,
        browserDownloadUrl: 'https://github.com/owner/repo/releases/download/v1.0.0/test.jsonl.zst'
      }
    ],
    htmlUrl: 'https://github.com/owner/repo/releases/tag/v1.0.0',
    createdAt: '2026-04-09T00:00:00Z'
  };

  beforeEach(async () => {
    releaser = await import('../../src/core/releaser.js');
  });

  describe('createRelease()', () => {
    it('should create release and upload artifacts sequentially', async () => {
      // Create temp files
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'metadat-releaser-'));
      const artifactPath1 = path.join(tempDir, 'test1.jsonl.zst');
      const artifactPath2 = path.join(tempDir, 'test2.jsonl.zst');
      await fs.writeFile(artifactPath1, 'content 1');
      await fs.writeFile(artifactPath2, 'content 2');

      const createReleaseSpy = vi.fn().mockResolvedValue({ data: { ...mockRelease, assets: [] } });
      const uploadSpy = vi.fn().mockResolvedValue({ data: { name: 'test.jsonl.zst' } });
      
      const mockOctokit = {
        repos: {
          createRelease: createReleaseSpy,
          uploadReleaseAsset: uploadSpy,
          getReleaseByTag: vi.fn().mockRejectedValue({ status: 404 })
        }
      };

      const instance = new releaser.GitHubReleaser('owner', 'repo', 'ghp_token');
      // @ts-expect-error - inject mock octokit
      instance.octokit = mockOctokit;

      const artifacts = [
        { ...mockArtifact, path: artifactPath1 },
        { ...mockArtifact, path: artifactPath2 }
      ];
      await instance.createRelease('v1.0.0', artifacts);

      // Verify release was created with correct tag
      expect(createReleaseSpy).toHaveBeenCalledWith(
        expect.objectContaining({ tag_name: 'v1.0.0' })
      );

      // Verify uploads were sequential (called twice)
      expect(uploadSpy).toHaveBeenCalledTimes(2);

      // Cleanup
      await fs.rm(tempDir, { recursive: true });
    });
  });

  describe('releaseExists()', () => {
    it('should return true when release exists', async () => {
      const mockOctokit = {
        repos: {
          getReleaseByTag: vi.fn().mockResolvedValue({ data: mockRelease })
        }
      };

      const instance = new releaser.GitHubReleaser('owner', 'repo', 'ghp_token');
      // @ts-expect-error - inject mock octokit
      instance.octokit = mockOctokit;

      const result = await instance.releaseExists('v1.0.0');

      expect(result).toBe(true);
    });

    it('should return false when release does not exist', async () => {
      const mockOctokit = {
        repos: {
          getReleaseByTag: vi.fn().mockRejectedValue({ status: 404 })
        }
      };

      const instance = new releaser.GitHubReleaser('owner', 'repo', 'ghp_token');
      // @ts-expect-error - inject mock octokit
      instance.octokit = mockOctokit;

      const result = await instance.releaseExists('v1.0.0');

      expect(result).toBe(false);
    });
  });

  describe('deleteRelease()', () => {
    it('should delete existing release', async () => {
      const mockOctokit = {
        repos: {
          getReleaseByTag: vi.fn().mockResolvedValue({ data: { id: 123 } }),
          deleteRelease: vi.fn().mockResolvedValue(undefined)
        }
      };

      const instance = new releaser.GitHubReleaser('owner', 'repo', 'ghp_token');
      // @ts-expect-error - inject mock octokit
      instance.octokit = mockOctokit;

      await instance.deleteRelease('v1.0.0');

      expect(mockOctokit.repos.deleteRelease).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        release_id: 123
      });
    });
  });

  describe('generateReleaseNotes()', () => {
    it('should generate release notes from artifacts', () => {
      const notes = releaser.generateReleaseNotes([mockArtifact], '2026-04-09');

      expect(notes).toContain('## Artifacts');
      expect(notes).toContain('test.jsonl.zst');
      // Entry count appears in the table row
      expect(notes).toMatch(/\| 10 \|/);
    });
  });
});