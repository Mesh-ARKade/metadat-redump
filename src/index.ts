/**
 * metadat-redump
 *
 * Redump DAT pipeline — fetches DATs from old.redump.info and publishes
 * compressed JSONL artifacts grouped by manufacturer.
 *
 * Structure:
 * - src/contracts/   - Interface definitions (IFetcher, IValidator, etc.)
 * - src/types/       - Core type definitions
 * - src/core/        - Shared implementations
 * - src/base/        - Abstract base classes
 * - src/data/        - System slug → bucket mapping table
 */

export type { DAT, GroupedDATs, Artifact, PipelineEvent, ValidationResult, Release } from './types/index.js';
export type { IFetcher } from './contracts/ifetcher.js';
export type { IValidator } from './contracts/ivalidator.js';
export type { ICompressor } from './contracts/icompressor.js';
export type { IGroupStrategy } from './contracts/igroup-strategy.js';
export type { IReleaser } from './contracts/ireleaser.js';
export type { INotifier } from './contracts/inotifier.js';

// Redump-specific exports
export { RedumpFetcher } from './fetcher.js';
export { RedumpGroupingStrategy, getArtifactName, getAllArtifactNames, datToArtifactName } from './group-strategy.js';
export type { RedumpSystem } from './data/systems.js';
export { REDUMP_SYSTEMS, getSystemBySlug, getBucketForSlug, getNameForSlug, getAllBuckets } from './data/systems.js';