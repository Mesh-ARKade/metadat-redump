/**
 * RedumpGroupingStrategy - Groups Redump DATs by manufacturer bucket
 *
 * @intent Assign each parsed DAT to one of 7 artifact buckets based on the systems mapping table.
 * @guarantee Produces artifact names in `redump--{bucket}` format (e.g., `redump--sony`).
 * @constraint Implements IGroupStrategy interface for pipeline compatibility.
 * @see specs/redump-grouping/spec.md
 */

import type { DAT, GroupedDATs } from './types/index.js';
import { IGroupStrategy } from './contracts/igroup-strategy.js';
import { REDUMP_SYSTEMS, getBucketForSlug } from './data/systems.js';

/**
 * RedumpGroupingStrategy - Groups Redump DATs by manufacturer bucket
 *
 * @intent All ~70 systems are grouped into 7 buckets: sony, nintendo, sega, microsoft, computers, other, bios.
 * @guarantee DATs are assigned to buckets based on their slug lookup in REDUMP_SYSTEMS.
 *            Unknown slugs log a warning and fall back to 'other' bucket.
 */
export class RedumpGroupingStrategy implements IGroupStrategy {
  /**
   * Group DATs by manufacturer bucket.
   * 
   * @param dats Array of DAT objects to group
   * @returns GroupedDATs map with bucket name as key (e.g., 'sony', 'nintendo')
   */
  group(dats: DAT[]): GroupedDATs {
    const groups: GroupedDATs = {};

    for (const dat of dats) {
      // Derive slug from DAT id: 'redump-{slug}' -> '{slug}'
      const slug = this.extractSlug(dat.id);

      // Look up the bucket for this slug
      const bucket = getBucketForSlug(slug);

      // Initialize group if needed
      if (!groups[bucket]) {
        groups[bucket] = [];
      }

      groups[bucket].push(dat);
    }

    // Log summary
    const groupNames = Object.keys(groups);
    console.log(`[grouping] Created ${groupNames.length} groups: ${groupNames.join(', ')}`);

    return groups;
  }

  /**
   * Extract slug from DAT id.
   * Format: 'redump-{slug}' -> '{slug}'
   */
  private extractSlug(datId: string): string {
    // DAT id format: 'redump-{slug}'
    const match = datId.match(/^redump-(.+)$/);
    return match ? match[1] : datId;
  }

  /**
   * Get the strategy name.
   * @returns 'redump' as the strategy identifier
   */
  getStrategyName(): string {
    return 'redump';
  }
}

/**
 * Get the artifact name for a bucket.
 * Format: `redump--{bucket}` (double dash separator)
 * 
 * @param bucket Bucket name (e.g., 'sony', 'nintendo')
 * @returns Artifact name (e.g., 'redump--sony')
 */
export function getArtifactName(bucket: string): string {
  return `redump--${bucket}`;
}

/**
 * Get all expected artifact names for Redump.
 * @returns Array of artifact names for all 7 buckets
 */
export function getAllArtifactNames(): string[] {
  const buckets = [...new Set(REDUMP_SYSTEMS.map(s => s.bucket))];
  return buckets.map(getArtifactName);
}

/**
 * Convert DAT to artifact name.
 * @param dat DAT object
 * @returns Artifact name (e.g., 'redump--sony')
 */
export function datToArtifactName(dat: DAT): string {
  const slug = dat.id.replace(/^redump-/, '');
  const bucket = getBucketForSlug(slug);
  return getArtifactName(bucket);
}
