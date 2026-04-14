/**
 * Redump Systems Mapping Table
 *
 * @intent Define every Redump system slug with its display name, artifact bucket, and optional BIOS slug.
 * @guarantee All ~70 systems are mapped to exactly one of 7 buckets. Bucket assignments match the
 *            OpenSpec design. Slugs are NOT derivable from system names (e.g., Philips CD-i → `cdi`).
 * @constraint This table is immutable per release cadence. New systems (~1-2/year) require a PR update.
 * @see specs/redump-systems-map/spec.md
 */

/**
 * Represents a Redump system entry.
 * 
 * @description 
 * - `biosSlug` is a REFERENCE to another slug in this table (the BIOS DAT's slug).
 *   The referenced slug exists as a separate entry in the `bios` bucket.
 *   e.g., `psx` has `biosSlug: 'psx-bios'` and `psx-bios` is a separate entry with `bucket: 'bios'`.
 */
export interface RedumpSystem {
  /** URL slug on old.redump.info (e.g., 'psx', 'dc', 'pc-98') */
  slug: string;
  /** Display name for JSONL output (e.g., 'Sony PlayStation') */
  name: string;
  /** Artifact bucket for grouping (e.g., 'sony', 'nintendo') */
  bucket: string;
  /** BIOS DAT slug if this system has a separate BIOS DAT on Redump (reference to another slug) */
  biosSlug?: string;
}

/**
 * All ~70 Redump systems mapped to 7 artifact buckets.
 * Slugs are NOT derivable from system names — hardcoded mapping required.
 * 
 * BIOS entries are in the `bios` bucket. Their parent systems reference them via `biosSlug`.
 * e.g., `psx` has `biosSlug: 'psx-bios'` and `psx-bios` is a separate entry with `bucket: 'bios'`.
 */
export const REDUMP_SYSTEMS: RedumpSystem[] = [
  // === SONY ===
  { slug: 'psx', name: 'Sony PlayStation', bucket: 'sony', biosSlug: 'psx-bios' },
  { slug: 'ps2', name: 'Sony PlayStation 2', bucket: 'sony', biosSlug: 'ps2-bios' },
  { slug: 'ps3', name: 'Sony PlayStation 3', bucket: 'sony' },
  { slug: 'ps4', name: 'Sony PlayStation 4', bucket: 'sony' },
  { slug: 'ps5', name: 'Sony PlayStation 5', bucket: 'sony' },
  { slug: 'psp', name: 'Sony PlayStation Portable', bucket: 'sony' },
  { slug: 'psxgs', name: 'PlayStation GameShark Updates', bucket: 'sony' },

  // === NINTENDO ===
  { slug: 'gc', name: 'Nintendo GameCube', bucket: 'nintendo', biosSlug: 'gc-bios' },
  { slug: 'wii', name: 'Nintendo Wii', bucket: 'nintendo' },
  { slug: 'wiiu', name: 'Nintendo Wii U', bucket: 'nintendo' },
  { slug: 'trf', name: 'Namco · Sega · Nintendo Triforce', bucket: 'nintendo' },

  // === SEGA ===
  { slug: 'ss', name: 'Sega Saturn', bucket: 'sega' },
  { slug: 'dc', name: 'Sega Dreamcast', bucket: 'sega' },
  { slug: 'mcd', name: 'Sega Mega CD & Sega CD', bucket: 'sega' },
  { slug: 'naomi', name: 'Sega Naomi', bucket: 'sega' },
  { slug: 'naomi2', name: 'Sega Naomi 2', bucket: 'sega' },
  { slug: 'chihiro', name: 'Sega Chihiro', bucket: 'sega' },
  { slug: 'lindbergh', name: 'Sega Lindbergh', bucket: 'sega' },
  { slug: 'sp21', name: 'Sega Prologue 21 Multimedia Karaoke System', bucket: 'sega' },
  { slug: 'sre', name: 'Sega RingEdge', bucket: 'sega' },
  { slug: 'sre2', name: 'Sega RingEdge 2', bucket: 'sega' },

  // === MICROSOFT ===
  { slug: 'xbox', name: 'Microsoft Xbox', bucket: 'microsoft', biosSlug: 'xbox-bios' },
  { slug: 'xbox360', name: 'Microsoft Xbox 360', bucket: 'microsoft' },
  { slug: 'xboxone', name: 'Microsoft Xbox One', bucket: 'microsoft' },
  { slug: 'xboxsx', name: 'Microsoft Xbox Series X', bucket: 'microsoft' },

  // === COMPUTERS ===
  { slug: 'pc', name: 'IBM PC compatible', bucket: 'computers' },
  { slug: 'mac', name: 'Apple Macintosh', bucket: 'computers' },
  { slug: 'arch', name: 'Acorn Archimedes', bucket: 'computers' },
  { slug: 'fmt', name: 'Fujitsu FM Towns series', bucket: 'computers' },
  { slug: 'pc-88', name: 'NEC PC-88 series', bucket: 'computers' },
  { slug: 'pc-98', name: 'NEC PC-98 series', bucket: 'computers' },
  { slug: 'pc-fx', name: 'NEC PC-FX & PC-FXGA', bucket: 'computers' },
  { slug: 'x68k', name: 'Sharp X68000', bucket: 'computers' },
  { slug: 'acd', name: 'Commodore Amiga CD', bucket: 'computers' },
  { slug: 'cd32', name: 'Commodore Amiga CD32', bucket: 'computers' },
  { slug: 'cdtv', name: 'Commodore Amiga CDTV', bucket: 'computers' },
  { slug: 'palm', name: 'Palm OS', bucket: 'computers' },
  { slug: 'ppc', name: 'Pocket PC', bucket: 'computers' },

  // === OTHER ===
  { slug: 'ajcd', name: 'Atari Jaguar CD Interactive Multimedia System', bucket: 'other' },
  { slug: 'audio-cd', name: 'Audio CD', bucket: 'other' },
  { slug: 'pippin', name: 'Bandai Pippin', bucket: 'other' },
  { slug: 'qis', name: 'Bandai Playdia Quick Interactive System', bucket: 'other' },
  { slug: 'bd-video', name: 'BD-Video', bucket: 'other' },
  { slug: 'dvd-video', name: 'DVD-Video', bucket: 'other' },
  { slug: 'fpp', name: 'funworld Photo Play', bucket: 'other' },
  { slug: 'hvn', name: 'Hasbro VideoNow', bucket: 'other' },
  { slug: 'hvnc', name: 'Hasbro VideoNow Color', bucket: 'other' },
  { slug: 'hvnjr', name: 'Hasbro VideoNow Jr.', bucket: 'other' },
  { slug: 'hvnxp', name: 'Hasbro VideoNow XP', bucket: 'other' },
  { slug: 'hddvd-video', name: 'HD DVD-Video', bucket: 'other' },
  { slug: 'ite', name: 'Incredible Technologies Eagle', bucket: 'other' },
  { slug: 'kea', name: 'Konami e-Amusement', bucket: 'other' },
  { slug: 'kfb', name: 'Konami FireBeat', bucket: 'other' },
  { slug: 'km2', name: 'Konami M2', bucket: 'other' },
  { slug: 'ks573', name: 'Konami System 573', bucket: 'other' },
  { slug: 'ksgv', name: 'Konami System GV', bucket: 'other' },
  { slug: 'ixl', name: 'Mattel Fisher-Price iXL', bucket: 'other' },
  { slug: 'hs', name: 'Mattel HyperScan', bucket: 'other' },
  { slug: 'vis', name: 'Memorex Visual Information System', bucket: 'other' },
  { slug: 'ns246', name: 'Namco System 246', bucket: 'other' },
  { slug: 'navi21', name: 'Navisoft Naviken 2.1', bucket: 'other' },
  { slug: 'pce', name: 'NEC PC Engine CD & TurboGrafx CD', bucket: 'other' },
  { slug: 'ngcd', name: 'Neo Geo CD', bucket: 'other' },
  { slug: '3do', name: 'Panasonic 3DO Interactive Multiplayer', bucket: 'other' },
  { slug: 'm2', name: 'Panasonic M2', bucket: 'other' },
  { slug: 'cdi', name: 'Philips CD-i', bucket: 'other' },
  { slug: 'photo-cd', name: 'Photo CD', bucket: 'other' },
  { slug: 'vcd', name: 'Video CD', bucket: 'other' },
  { slug: 'nuon', name: 'VM Labs NUON', bucket: 'other' },
  { slug: 'vflash', name: 'VTech V.Flash & V.Smile Pro', bucket: 'other' },
  { slug: 'gamewave', name: 'ZAPiT Games Game Wave Family Entertainment System', bucket: 'other' },
  { slug: 'quizard', name: 'TAB-Austria Quizard', bucket: 'other' },
  { slug: 'ksite', name: 'Tomy Kiss-Site', bucket: 'other' },

  // === BIOS (separate entries, referenced by parent systems) ===
  { slug: 'psx-bios', name: 'Sony PlayStation BIOS', bucket: 'bios' },
  { slug: 'ps2-bios', name: 'Sony PlayStation 2 BIOS', bucket: 'bios' },
  { slug: 'gc-bios', name: 'Nintendo GameCube BIOS', bucket: 'bios' },
  { slug: 'xbox-bios', name: 'Microsoft Xbox BIOS', bucket: 'bios' },
];

/**
 * Lookup map for O(1) slug-to-system access
 */
const SLUG_MAP = new Map<string, RedumpSystem>(
  REDUMP_SYSTEMS.map(s => [s.slug, s])
);

/**
 * Get a system by its slug.
 * @param slug URL slug (e.g., 'psx', 'dc', 'pc-98')
 * @returns The RedumpSystem or undefined if not found
 */
export function getSystemBySlug(slug: string): RedumpSystem | undefined {
  return SLUG_MAP.get(slug);
}

/**
 * Get the artifact bucket for a given slug.
 * @param slug URL slug
 * @returns Bucket name (e.g., 'sony') or 'other' as fallback for unknown slugs
 */
export function getBucketForSlug(slug: string): string {
  const system = SLUG_MAP.get(slug);
  if (!system) {
    console.warn(`[systems] Unknown slug: '${slug}' - falling back to 'other' bucket`);
    return 'other';
  }
  return system.bucket;
}

/**
 * Get the display name for a given slug.
 * @param slug URL slug
 * @returns Display name or slug as fallback
 */
export function getNameForSlug(slug: string): string {
  const system = SLUG_MAP.get(slug);
  return system?.name ?? slug;
}

/**
 * Get all unique buckets from the systems table.
 * @returns Array of bucket names
 */
export function getAllBuckets(): string[] {
  return [...new Set(REDUMP_SYSTEMS.map(s => s.bucket))].sort();
}
