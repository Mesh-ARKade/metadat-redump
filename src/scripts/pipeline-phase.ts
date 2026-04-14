/**
 * Pipeline Phase Runner
 * 
 * @intent Run individual pipeline phases for GitHub Actions visibility.
 * @guarantee Each phase can run independently with proper state management via .pipeline-state.json.
 * @see specs/redump-pipeline-phases/spec.md
 */

import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { ZodError } from 'zod';
import { VersionTracker } from '../core/version-tracker.js';
import { GitHubReleaser } from '../core/releaser.js';
import type { DAT, GroupedDATs, Artifact } from '../types/index.js';
import { validatePipelineState } from '../types/index.js';
import { RedumpFetcher } from '../fetcher.js';
import { RedumpGroupingStrategy, getArtifactName } from '../group-strategy.js';

type Phase = 'fetch' | 'group' | 'dict' | 'jsonl' | 'compress' | 'release';

/**
 * Pipeline state interface
 */
interface PipelineState {
  phase?: 'fetch' | 'group' | 'compress';
  source: string;
  dats?: DAT[];
  groupedDats?: GroupedDATs;
  artifacts?: Artifact[];
  dictPath?: string;
  // Counts saved before clearing large arrays
  datCount?: number;
  romCount?: number;
  groupCount?: number;
  // Last release artifact SHA256s for incremental detection
  lastArtifacts?: Record<string, string>;
}

const STATE_FILE = '.pipeline-state.json';

/**
 * Convert a string into a URL/filename-safe slug.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Load pipeline state from file.
 */
async function loadState(): Promise<PipelineState | null> {
  try {
    const data = await fs.readFile(STATE_FILE, 'utf-8');
    const parsed = JSON.parse(data);

    // Validate loaded state against Zod schema
    try {
      validatePipelineState(parsed);
    } catch (zodErr) {
      if (zodErr instanceof ZodError) {
        console.warn('[state] Loaded state failed validation:', zodErr.errors.map(e => e.message).join(', '));
        return null;
      }
      throw zodErr;
    }

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Save pipeline state to file.
 */
async function saveState(state: PipelineState, phase?: 'fetch' | 'group' | 'compress'): Promise<void> {
  if (phase) state.phase = phase;
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

/**
 * Run a specific pipeline phase.
 */
async function runPhase(options: {
  source: string;
  phase: Phase;
  outputDir: string;
}): Promise<void> {
  const outputDir = options.outputDir;
  await fs.mkdir(outputDir, { recursive: true });

  const state = await loadState() || { source: options.source };

  switch (options.phase) {
    case 'fetch': {
      console.log('[phase:fetch] Fetching DATs from old.redump.info...');
      const versionTracker = new VersionTracker('./versions.json');
      const fetcher = new RedumpFetcher(versionTracker, outputDir);

      try {
        const dats = await fetcher.fetchDats();
        const result = fetcher.lastResult;
        console.log(`[phase:fetch] Fetched ${dats.length} DATs`);

        // Export fetch details to GITHUB_ENV for notifications
        if (process.env.GITHUB_ENV && result) {
          const details: string[] = [];
          if (result.skipped.length > 0) details.push(`Skipped (unchanged): ${result.skipped.length}`);
          if (result.failed.length > 0) details.push(`Failed: ${result.failed.map(f => `${f.slug} (${f.reason})`).join(', ')}`);
          if (details.length > 0) {
            await fs.appendFile(process.env.GITHUB_ENV, `PIPELINE_FETCH_DETAILS=${details.join(' | ')}\n`);
          }
        }

        if (dats.length === 0) {
          const storedInfo = versionTracker.read('redump');
          if (storedInfo && Object.keys(storedInfo as unknown as Record<string, unknown>).some(k => k !== 'version' && k !== 'lastChecked')){
            console.log('[phase:fetch] All systems unchanged, skipping pipeline...');
            if (process.env.GITHUB_ENV) {
              await fs.appendFile(process.env.GITHUB_ENV, 'SKIP_PIPELINE=true\n');
            }
            await fetcher.close();
            return;
          }
          throw new Error('No DATs fetched - source may be unavailable');
        }

        state.dats = dats;
        await saveState(state, 'fetch');
      } catch (err) {
        const msg = (err as Error).message;
        console.error(`[phase:fetch] Error: ${msg}`);
        if (process.env.GITHUB_ENV) {
          await fs.appendFile(process.env.GITHUB_ENV, `PIPELINE_ERROR=${msg}\n`);
        }
        throw err;
      } finally {
        await fetcher.close();
      }
      break;
    }

    case 'group': {
      console.log('[phase:group] Grouping DATs by manufacturer...');
      if (!state.dats) {
        throw new Error('No DATs loaded - run fetch phase first');
      }

      const groupStrategy = new RedumpGroupingStrategy();
      const groupedDats = groupStrategy.group(state.dats);
      const groupNames = Object.keys(groupedDats);

      console.log(`[phase:group] Created ${groupNames.length} groups: ${groupNames.join(', ')}`);

      state.groupedDats = groupedDats;
      await saveState(state, 'group');
      break;
    }

    case 'dict': {
      console.log('[phase:dict] Checking for immutable dictionary...');
      const { hasImmutableDictionary, trainDictionary } = await import('../core/compressor.js');

      if (hasImmutableDictionary()) {
        console.log('[phase:dict] Immutable dictionary found, skipping training');
        break;
      }

      console.log('[phase:dict] Training dictionary...');
      if (!state.dats) {
        throw new Error('No DATs loaded - run fetch phase first');
      }

      const dictDir = path.join(outputDir, '.dict');
      await fs.mkdir(dictDir, { recursive: true });

      const dictPath = path.join(dictDir, `${options.source}.dict`);
      const sample = JSON.stringify(state.dats.slice(0, 10));

      await trainDictionary([sample], dictPath);
      console.log(`[phase:dict] Dictionary trained: ${dictPath}`);

      // Save trained dictionary to immutable path as well
      const IMMUTABLE_DICT_PATH = 'src/data/catalog.dict';
      await fs.mkdir(path.dirname(IMMUTABLE_DICT_PATH), { recursive: true });
      await fs.copyFile(dictPath, IMMUTABLE_DICT_PATH);
      console.log(`[phase:dict] Saved to immutable path: ${IMMUTABLE_DICT_PATH}`);

      state.dictPath = dictPath;
      await saveState(state);
      break;
    }

    case 'jsonl': {
      console.log('[phase:jsonl] Creating JSONL files...');
      if (!state.groupedDats) {
        throw new Error('No grouped DATs - run group phase first');
      }

      const groupNames = Object.keys(state.groupedDats);

      for (const groupName of groupNames) {
        const groupDats = state.groupedDats[groupName];
        if (!groupDats || groupDats.length === 0) continue;

        const jsonlContent = groupDats.map((d: DAT) => JSON.stringify(d)).join('\n');
        const artifactName = getArtifactName(groupName);
        const jsonlFileName = `${artifactName}.jsonl`;
        const jsonlPath = path.join(outputDir, jsonlFileName);

        await fs.writeFile(jsonlPath, jsonlContent);
        console.log(`[phase:jsonl] Created: ${jsonlFileName} (${groupDats.length} entries)`);
      }
      break;
    }

    case 'compress': {
      console.log('[phase:compress] Compressing to ZST...');
      if (!state.groupedDats) {
        throw new Error('No grouped DATs - run group phase first');
      }

      const { compress, compressWithDictionary, compressWithImmutableDict, hasImmutableDictionary } = await import('../core/compressor.js');

      // Load last release artifact hashes for incremental detection
      const versionTracker = new VersionTracker('./versions.json');
      const lastArtifacts = await versionTracker.getArtifactHashes(options.source);
      if (lastArtifacts && Object.keys(lastArtifacts).length > 0) {
        state.lastArtifacts = lastArtifacts;
        console.log('[phase:compress] Loaded last release artifacts for comparison');
      }

      const artifacts: Artifact[] = [];
      const groupNames = Object.keys(state.groupedDats);

      // Check for dictionary
      const useImmutable = hasImmutableDictionary();
      let dictPath = '';
      if (!useImmutable && state.dictPath) {
        try {
          await fs.readFile(state.dictPath);
          dictPath = state.dictPath;
          console.log('[phase:compress] Using temporary dictionary');
        } catch {
          console.log('[phase:compress] Temporary dictionary not found, using standard compression');
        }
      }

      for (const groupName of groupNames) {
        const groupDats = state.groupedDats[groupName];
        if (!groupDats || groupDats.length === 0) continue;

        const jsonlContent = groupDats.map((d: DAT) => JSON.stringify(d)).join('\n');
        const artifactName = getArtifactName(groupName);
        const zstFileName = `${artifactName}.jsonl.zst`;
        const zstPath = path.join(outputDir, zstFileName);

        let artifact;
        if (useImmutable) {
          artifact = await compressWithImmutableDict(jsonlContent, zstPath);
        } else if (dictPath) {
          try {
            artifact = await compressWithDictionary(jsonlContent, zstPath, dictPath);
          } catch {
            artifact = await compress(jsonlContent, zstPath);
          }
        } else {
          artifact = await compress(jsonlContent, zstPath);
        }

        // Track op for incremental release
        let op: 'upsert' | 'unchanged' = 'upsert';
        const lastSha = state.lastArtifacts?.[artifact.name];
        if (lastSha && lastSha === artifact.sha256) {
          op = 'unchanged';
          console.log(`[phase:compress] Unchanged: ${zstFileName}`);
        }

        // Aggregate systems info
        const systemsInfo = Object.entries(
          groupDats.reduce((acc: Record<string, number>, d) => {
            acc[d.system] = (acc[d.system] || 0) + 1;
            return acc;
          }, {})
        ).map(([name, gameCount]) => ({ id: slugify(name), name, gameCount }));

        const artifactRomCount = groupDats.reduce((s: number, d: DAT) => s + (d.roms?.length || 0), 0);

        const newArtifact: Artifact = {
          name: artifact.name,
          path: artifact.path,
          size: artifact.size,
          sha256: artifact.sha256,
          entryCount: artifact.entryCount,
          romCount: artifactRomCount,
          op,
          systems: systemsInfo,
        };

        artifacts.push(newArtifact);
        console.log(`[phase:compress] Created: ${zstFileName} (${artifact.size} bytes)`);
      }

      // Create manifest
      const manifest = {
        version: '1.0.0',
        generated: new Date().toISOString(),
        sources: [{
          name: options.source as 'redump',
          repo: `Mesh-ARKade/metadat-${options.source}`,
          release: `${options.source}-${new Date().toISOString().split('T')[0]}`,
          date: new Date().toISOString().split('T')[0],
          artifacts: artifacts.map(a => ({
            name: a.name,
            url: `https://github.com/Mesh-ARKade/metadat-${options.source}/releases/latest/${a.name}`,
            size: a.size,
            sha256: a.sha256,
            systems: a.systems || [],
          })),
        }],
      };

      const manifestPath = path.join(outputDir, 'manifest.json');
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      console.log('[phase:compress] Created: manifest.json');

      // Save counts before clearing large arrays
      state.datCount = groupNames.reduce((sum, g) => sum + (state.groupedDats?.[g]?.length || 0), 0);
      state.groupCount = groupNames.length;
      state.romCount = groupNames.reduce((sum, g) => {
        return sum + (state.groupedDats?.[g] || []).reduce((s, d) => s + (d.roms?.length || 0), 0);
      }, 0);

      // Clean up state - don't save large DATs
      state.artifacts = artifacts;
      state.dats = undefined;
      state.groupedDats = undefined;
      await saveState(state, 'compress');
      break;
    }

    case 'release': {
      const startTime = Date.now();
      console.log('[phase:release] Creating GitHub release...');
      if (!state.artifacts || state.artifacts.length === 0) {
        throw new Error('No artifacts - run compress phase first');
      }

      const versionTracker = new VersionTracker('./versions.json');

      const releaser = new GitHubReleaser(
        process.env.GITHUB_OWNER || 'Mesh-ARKade',
        process.env.GITHUB_REPO || `metadat-${options.source}`,
        process.env.GITHUB_TOKEN || ''
      );

      // Include manifest in release
      const manifestPath = path.join(outputDir, 'manifest.json');
      const manifestContent = await fs.readFile(manifestPath, 'utf-8');
      const manifestArtifact: Artifact = {
        name: 'manifest.json',
        path: manifestPath,
        size: manifestContent.length,
        sha256: '',
        entryCount: 0,
        op: 'upsert',
        systems: [],
      };

      // Only upload changed artifacts + manifest
      const artifactsToUpload = state.artifacts.filter(a => a.op === 'upsert');
      const unchangedCount = state.artifacts.filter(a => a.op === 'unchanged').length;
      console.log(`[phase:release] ${artifactsToUpload.length} changed, ${unchangedCount} unchanged`);

      const releaseArtifacts: Artifact[] = [...artifactsToUpload, manifestArtifact];
      const allReleaseArtifacts: Artifact[] = [...state.artifacts, manifestArtifact];
      const tag = `${options.source}-${new Date().toISOString().split('T')[0]}`;
      const release = await releaser.createReleaseIncremental(tag, releaseArtifacts, allReleaseArtifacts);

      // Export variables for GitHub Actions
      if (process.env.GITHUB_ENV) {
        const totalEntries = state.artifacts.reduce((sum, a) => sum + a.entryCount, 0);
        const totalSize = state.artifacts.reduce((sum, a) => sum + a.size, 0);
        const uploadSize = artifactsToUpload.reduce((sum, a) => sum + a.size, 0);
        const savedSize = state.artifacts.filter(a => a.op === 'unchanged').reduce((sum, a) => sum + a.size, 0);

        const formatSize = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2) + ' MB';

        const fetchDetails = process.env.PIPELINE_FETCH_DETAILS || '';

        const stats = [
          { metric: 'Systems', value: (state.datCount || 0).toLocaleString() },
          { metric: 'ROMs', value: (state.romCount || 0).toLocaleString() },
          { metric: 'Groups', value: (state.groupCount || 0).toString() },
          { metric: 'Artifacts', value: `${artifactsToUpload.length} new / ${unchangedCount} skip` },
          { metric: 'Upload', value: formatSize(uploadSize) },
          { metric: 'Saved', value: formatSize(savedSize) },
          { metric: 'Total Size', value: formatSize(totalSize) },
          ...(fetchDetails ? [{ metric: 'Fetch', value: fetchDetails }] : []),
        ];

        const envContent = [
          `PIPELINE_RELEASE_URL=${release.htmlUrl}`,
          `PIPELINE_ENTRIES=${totalEntries}`,
          `PIPELINE_ARTIFACTS=${state.artifacts.length}`,
          `PIPELINE_STATS=${JSON.stringify(stats)}`,
          `PIPELINE_DURATION=${Date.now() - startTime}`,
        ].join('\n') + '\n';

        await fs.appendFile(process.env.GITHUB_ENV, envContent);
      }

      // Save artifact hashes for incremental tracking
      const artifactHashes: Record<string, string> = {};
      for (const a of state.artifacts) {
        if (a.sha256) {
          artifactHashes[a.name] = a.sha256;
        }
      }
      await versionTracker.saveArtifactHashes(options.source, artifactHashes);
      console.log('[phase:release] Saved artifact hashes for incremental tracking');

      // Clean up state file
      await fs.unlink(STATE_FILE).catch(() => {});
      break;
    }
  }

  console.log(`[phase:${options.phase}] Complete`);
}

// ============================================================================
// CLI Entry Point
// ============================================================================

const { values } = parseArgs({
  options: {
    source: { type: 'string', short: 's', default: 'redump' },
    phase: { type: 'string' },
    'output-dir': { type: 'string', short: 'o', default: './output' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (values.help || !values.phase) {
  console.log(`
Pipeline Phase Runner - Redump
Usage: node dist/scripts/pipeline-phase.js [options]

Options:
  --phase <phase>    Phase to run: fetch, group, dict, jsonl, compress, release
  -s, --source       Source name (default: redump)
  -o, --output-dir   Output directory (default: ./output)
  -h, --help

Phases:
  fetch     - Download DATs from old.redump.info (HEAD check + Playwright download)
  group     - Group DATs by manufacturer bucket
  dict      - Train compression dictionary (immutable once created)
  jsonl     - Create JSONL files per bucket
  compress  - Compress to ZST with dictionary
  release   - Create GitHub release (incremental)
`);
  process.exit(0);
}

runPhase({
  source: values.source || 'redump',
  phase: values.phase as Phase,
  outputDir: values['output-dir'] || './output',
}).catch(err => {
  console.error(`[phase] Error: ${(err as Error).message}`);
  process.exit(1);
});
