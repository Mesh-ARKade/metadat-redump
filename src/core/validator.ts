/**
 * XmlValidator - Validates XML DAT files
 *
 * @intent Validate XML well-formedness and extract game entries
 * @guarantee Handles multiple DAT formats with fallback parsers
 */

import fs from 'fs/promises';
import { XMLValidator, XMLParser } from 'fast-xml-parser';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export interface GameEntry {
  name: string;
  description?: string;
  [key: string]: unknown;
}

export interface ExtractResult {
  valid: boolean;
  games: GameEntry[];
  error?: string;
}

/**
 * Validate well-formed XML content
 * @param content XML string to validate
 * @returns ValidationResult with valid flag and optional error
 */
export function validateWellFormed(content: string): ValidationResult {
  if (!content || content.trim().length === 0) {
    return { valid: false, error: 'Empty XML content' };
  }

  const result = XMLValidator.validate(content, {
    allowBooleanAttributes: true
  });

  if (result === true) {
    return { valid: true };
  }

  return {
    valid: false,
    error: result.err.msg
  };
}

/**
 * Validate a file path containing XML
 * @param filePath Path to file
 * @returns ValidationResult
 */
export async function validateFile(filePath: string): Promise<ValidationResult> {
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return validateWellFormed(content);
  } catch (err) {
    return {
      valid: false,
      error: `File read error: ${(err as Error).message}`
    };
  }
}

/**
 * Check if file has valid DAT/XML extension
 * @param filePath File name to check
 * @returns ValidationResult
 */
export function checkExtension(filePath: string): ValidationResult {
  const validExtensions = ['.dat', '.DAT', '.xml', '.XML'];
  const hasExtension = validExtensions.some(ext =>
    filePath.toLowerCase().endsWith(ext)
  );

  if (!hasExtension) {
    return {
      valid: false,
      error: `File ${filePath} does not have .dat or .xml extension`
    };
  }

  return { valid: true };
}

/**
 * Extract game entries from DAT XML with multiple format support
 * @param content XML content
 * @returns ExtractResult with games array
 */
export function extractGameEntries(content: string): ExtractResult {
  const validation = validateWellFormed(content);
  if (!validation.valid) {
    return { valid: false, games: [], error: validation.error };
  }

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
      parseTagValue: true
    });

    const parsed = parser.parse(content);
    const games: GameEntry[] = [];

    // Try specific parsers first
    if (parsed.datafile?.game) {
      extractDatafileGames(parsed.datafile.game, games);
    } else if (parsed.mame?.machine) {
      extractMameMachines(parsed.mame.machine, games);
    } else if (parsed.mame?.game) {
      extractMameMachines(parsed.mame.game, games);
    } else if (parsed.softwarelist?.software) {
      extractSoftwareList(parsed.softwarelist.software, games, parsed.softwarelist['@_name']);
    } else if (parsed.mame) {
      // MAME root - search recursively
      extractAllMameEntries(parsed.mame, games);
    } else if (parsed.datafile) {
      // Generic datafile search
      extractGenericDatafile(parsed.datafile, games);
    } else {
      // Last resort: direct extraction
      extractDirectEntries(parsed, games);
    }

    return { valid: true, games };
  } catch (err) {
    return {
      valid: false,
      games: [],
      error: `Parse error: ${(err as Error).message}`
    };
  }
}

// --- Helper functions for different XML formats ---

function extractDatafileGames(data: unknown, games: GameEntry[]): void {
  const arr = Array.isArray(data) ? data : [data];
  for (const g of arr) {
    if (g && typeof g === 'object') {
      games.push({
        name: g['@_name'] || (g as any).name,
        description: (g as any).description,
        ...(g as Record<string, unknown>)
      });
    }
  }
}

function extractMameMachines(data: unknown, games: GameEntry[]): void {
  const arr = Array.isArray(data) ? data : [data];
  for (const m of arr) {
    if (m && typeof m === 'object') {
      const n = m['@_name'] || (m as any).name;
      if (n) {
        games.push({
          name: n,
          description: (m as any).description,
          year: (m as any).year,
          manufacturer: (m as any).manufacturer,
          ...(m as Record<string, unknown>)
        });
      }
    }
  }
}

function extractSoftwareList(data: unknown, games: GameEntry[], listName?: string): void {
  const arr = Array.isArray(data) ? data : [data];
  for (const s of arr) {
    if (s && typeof s === 'object') {
      const n = s['@_name'] || (s as any).name;
      if (n) {
        games.push({
          name: n,
          description: (s as any).description,
          year: (s as any).year,
          publisher: (s as any).publisher,
          softwarelist: listName,
          ...(s as Record<string, unknown>)
        });
      }
    }
  }
}

function extractAllMameEntries(obj: unknown, games: GameEntry[]): void {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;

  // Check for entries at this level
  if (o.machine) extractMameMachines(o.machine as unknown, games);
  else if (o.game) extractMameMachines(o.game as unknown, games);
  else if (o.machines) extractAllMameEntries(o.machines, games);
  else if (o.games) extractAllMameEntries(o.games, games);

  // Recurse into other properties
  for (const [key, value] of Object.entries(o)) {
    if (value && typeof value === 'object' &&
        key !== 'machine' && key !== 'game' && key !== 'machines' && key !== 'games') {
      extractAllMameEntries(value, games);
    }
  }
}

function extractGenericDatafile(datafile: unknown, games: GameEntry[]): void {
  if (!datafile || typeof datafile !== 'object') return;
  const d = datafile as Record<string, unknown>;

  const containers = ['game', 'machine', 'software', 'entry', 'item', 'record'];
  for (const key of Object.keys(d)) {
    if (containers.includes(key.toLowerCase())) {
      const data = d[key];
      if (Array.isArray(data)) {
        for (const item of data) {
          if (item && typeof item === 'object') {
            const entry = item as Record<string, unknown>;
            const name = entry['@_name'] || entry.name || entry['@name'];
            if (name) {
              games.push({
                name: String(name),
                description: String(entry.description || ''),
                ...entry
              });
            }
          }
        }
      } else if (data && typeof data === 'object') {
        const entry = data as Record<string, unknown>;
        const name = entry['@_name'] || entry.name || entry['@name'];
        if (name) {
          games.push({
            name: String(name),
            description: String(entry.description || ''),
            ...entry
          });
        }
      }
    }
  }
}

function extractDirectEntries(obj: unknown, games: GameEntry[]): void {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;

  for (const [, value] of Object.entries(o)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') {
          const entry = item as Record<string, unknown>;
          const name = entry['@_name'] || entry.name || entry['@name'] || entry.id;
          if (name) {
            games.push({
              name: String(name),
              description: String(entry.description || entry.title || ''),
              source: 'unknown',
              ...entry
            });
          }
        }
      }
    } else if (value && typeof value === 'object') {
      const entry = value as Record<string, unknown>;
      const name = entry['@_name'] || entry.name || entry['@name'] || entry.id;
      if (name) {
        games.push({
          name: String(name),
          description: String(entry.description || entry.title || ''),
          source: 'unknown',
          ...entry
        });
      }
    }
  }
}

/**
 * XmlValidator class (alternative interface)
 */
export class XmlValidator {
  /**
   * Validate XML content
   */
  static validate(content: string): ValidationResult {
    return validateWellFormed(content);
  }

  /**
   * Validate file
   */
  static async validateFilePath(filePath: string): Promise<ValidationResult> {
    return validateFile(filePath);
  }

  /**
   * Extract game entries
   */
  static extract(content: string): ExtractResult {
    return extractGameEntries(content);
  }
}
