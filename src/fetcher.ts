/**
 * RedumpFetcher - Fetches DATs from old.redump.info
 *
 * @intent Download per-system DAT files from old.redump.info, parse into DAT objects.
 * @guarantee Returns properly typed DAT[] ready for grouping.
 * @constraint Uses direct HTTP with unzipper for most systems, Playwright fallback.
 */

import path from 'path';
import fs from 'fs/promises';
import fsSync from 'fs';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import unzipper from 'unzipper';
import { chromium, type Browser, type Page } from 'playwright';
import { AbstractFetcher, type FetcherOptions } from './base/base-fetcher.js';
import { VersionTracker } from './core/version-tracker.js';
import type { DAT, RomEntry } from './types/index.js';
import { REDUMP_SYSTEMS, type RedumpSystem } from './data/systems.js';

const REDUMP_BASE_URL = 'https://old.redump.info/datfile';
const JITTER_MIN = 1000;
const JITTER_MAX = 3000;

import { XMLParser } from 'fast-xml-parser';
const xmlParser = new XMLParser({
  attributeNamePrefix: '@_',
  ignoreAttributes: false,
  textNodeName: '#text',
});

export interface FetchResult {
  dats: DAT[];
  downloaded: number;
  skipped: string[];
  failed: Array<{ slug: string; reason: string }>;
  parsed: number;
}

export class RedumpFetcher extends AbstractFetcher {
  private workDir: string;
  private screenshotsDir: string;
  private browser: Browser | null = null;
  private _lastResult: FetchResult | null = null;

  /** Access fetch result details (skipped/failed systems) after fetchDats() */
  get lastResult(): FetchResult | null { return this._lastResult; }

  constructor(versionTracker: VersionTracker, outputDir = './output/redump', options: FetcherOptions = {}) {
    super(versionTracker, {
      maxRetries: options.maxRetries ?? 3,
      retryDelay: options.retryDelay ?? 5000,
      rateLimitMs: options.rateLimitMs ?? 2000,
    });
    this.workDir = path.join(outputDir, 'work');
    this.screenshotsDir = path.join(outputDir, 'screenshots');
  }

  getSourceName(): string { return 'redump'; }

  async checkRemoteVersion(): Promise<string> {
    // Redump has ~70 independent systems — no single "version" to check.
    // Per-slug version checking happens inside fetchDats(). This method
    // satisfies the abstract contract; the base class shouldSkip() will
    // always return false (stored version is never just a date string),
    // ensuring fetchDats() runs and does its own per-slug checks.
    return new Date().toISOString().split('T')[0];
  }

  private getDatUrl(slug: string): string { return `${REDUMP_BASE_URL}/${slug}/`; }

  private async applyJitter(): Promise<void> {
    const jitter = JITTER_MIN + Math.random() * (JITTER_MAX - JITTER_MIN);
    await new Promise(r => setTimeout(r, jitter));
  }

  private async checkRemoteVersionForSlug(slug: string): Promise<string | null> {
    try {
      const r = await fetch(this.getDatUrl(slug), { method: 'HEAD', redirect: 'manual' });
      if (r.status === 302) return r.headers.get('location') || null;
      return null;
    } catch { return null; }
  }

  private resolveUrl(loc: string): string {
    return loc.startsWith('http') ? loc : `https://old.redump.info${loc}`;
  }

  private async download(url: string, dest: string): Promise<void> {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Download failed: ${r.status}`);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const s = fsSync.createWriteStream(dest);
    await pipeline(Readable.fromWeb(r.body as any), s);
  }

  private async ensureBrowser(): Promise<void> {
    if (!this.browser) this.browser = await chromium.launch({ headless: true });
  }

  // Screenshot capture available for error handling
  async captureErrorScreenshot(page: Page, slug: string): Promise<string | null> {
    try {
      await fs.mkdir(this.screenshotsDir, { recursive: true });
      const p = path.join(this.screenshotsDir, `error-${slug}.png`);
      await page.screenshot({ path: p, fullPage: true });
      return p;
    } catch { return null; }
  }

  private async extract(zipPath: string, slug: string): Promise<string | null> {
    const dir = path.join(this.workDir, `extracted-${slug}`);
    try { await fs.mkdir(dir, { recursive: true }); } catch {}
    let datPath: string | null = null;
    await new Promise<void>((resolve, reject) => {
      fsSync.createReadStream(zipPath)
        .pipe(unzipper.Parse())
        .on('entry', (entry: unzipper.Entry) => {
          if (entry.path.endsWith('.dat')) {
            const dest = path.join(dir, path.basename(entry.path));
            entry.pipe(fsSync.createWriteStream(dest));
            datPath = dest;
          } else entry.autodrain();
        })
        .on('close', resolve)
        .on('error', reject);
    });
    return datPath;
  }

  private async parse(filePath: string, system: RedumpSystem): Promise<DAT | null> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      let parsed: Record<string, unknown>;
      try { parsed = xmlParser.parse(content) as Record<string, unknown>; }
      catch { console.warn(`[fetcher] XML parse error: ${path.basename(filePath)}`); return null; }

      // Redump uses <datafile> root; some BIOS DATs may use <dat>
      const df = (parsed['datafile'] || parsed['dat']) as Record<string, unknown> | undefined;
      if (!df) {
        console.warn(`[fetcher] No datafile root in ${system.slug}, keys: ${Object.keys(parsed).join(', ')}`);
        return null;
      }

      const header = (df['header'] as Record<string, unknown>) || {};
      const datVersion = String(header['version'] || header['date'] || new Date().toISOString().split('T')[0]);
      // Redump uses <game>; MAME-style DATs use <machine>
      const games = df['game'] || df['machine'];
      if (!games) {
        console.warn(`[fetcher] No game elements in ${system.slug}, df keys: ${Object.keys(df).join(', ')}`);
        return null;
      }

      const gameArray = Array.isArray(games) ? games : [games];
      const roms: RomEntry[] = [];
      for (const game of gameArray as Record<string, unknown>[]) {
        const romEl = game['rom'];
        if (!romEl) continue;
        const ra = Array.isArray(romEl) ? romEl : [romEl];
        for (const r of ra as Record<string, unknown>[]) {
          const ro = r as Record<string, unknown>;
          const entry: RomEntry = { name: String(ro['@_name'] || ''), size: Number(ro['@_size'] || 0) || 0 };
          if (ro['@_crc']) entry.crc = String(ro['@_crc']);
          if (ro['@_md5']) entry.md5 = String(ro['@_md5']);
          if (ro['@_sha1']) entry.sha1 = String(ro['@_sha1']);
          if (ro['@_sha256']) entry.sha256 = String(ro['@_sha256']);
          if (entry.name) roms.push(entry);
        }
      }

      return { id: `redump-${system.slug}`, source: 'redump', system: system.name, datVersion, roms, description: String(header['description'] || system.name) };
    } catch (err) { console.error(`[fetcher] Parse error: ${(err as Error).message}`); return null; }
  }

  async fetchDats(): Promise<DAT[]> {
    await fs.mkdir(this.workDir, { recursive: true });
    const dats: DAT[] = [];
    const versionUpdates: Record<string, string> = {};
    let downloaded = 0;
    const skippedSystems: string[] = [];
    const failedSystems: Array<{ slug: string; reason: string }> = [];

    console.log(`[fetcher] Starting fetch for ${REDUMP_SYSTEMS.length} systems...`);

    for (const system of REDUMP_SYSTEMS) {
      await this.applyJitter();

      const remoteLoc = await this.checkRemoteVersionForSlug(system.slug);
      const storedLoc = this.getStoredVersionForSlug(system.slug);
      if (remoteLoc && remoteLoc === storedLoc) {
        skippedSystems.push(system.slug);
        continue;
      }

      const filePath = path.join(this.workDir, `${system.slug}.download`);
      let downloadOk = false;

      // Try download with one retry
      for (let attempt = 0; attempt < 2; attempt++) {
        let page: Page | null = null;
        try {
          if (attempt === 0) console.log(`[fetcher] Downloading ${system.slug}...`);
          else console.log(`[fetcher] Retrying ${system.slug}...`);

          const url = remoteLoc || await this.checkRemoteVersionForSlug(system.slug);
          if (!url) { break; } // no URL available, can't retry

          const fullUrl = this.resolveUrl(url);
          await this.download(fullUrl, filePath);
          downloadOk = true;
          break;
        } catch {
          // Fallback: Playwright
          try {
            console.log(`[fetcher] Trying Playwright for ${system.slug}...`);
            await this.ensureBrowser();
            page = await this.browser!.newPage();
            const dp = page.waitForEvent('download', { timeout: 30000 });
            await page.goto(this.getDatUrl(system.slug), { timeout: 30000 }).catch(() => {});
            const dl = await dp;
            await dl.saveAs(filePath);
            downloadOk = true;
            break;
          } catch {
            // Capture screenshot on final attempt before closing page
            if (attempt === 1 && page) {
              await this.captureErrorScreenshot(page, system.slug);
            }
            await page?.close();
            page = null;
            if (attempt === 0) {
              await new Promise(r => setTimeout(r, 3000));
            }
          } finally { await page?.close(); }
        }
      }

      if (!downloadOk) {
        failedSystems.push({ slug: system.slug, reason: 'download failed after retry' });
        console.warn(`[fetcher] Failed after retry: ${system.slug}`);
        continue;
      }
      downloaded++;

      // BIOS datfiles return raw .dat (XML), others return .zip
      let datPath: string | null = null;
      const fileHeader = await fs.readFile(filePath, { encoding: null }).then(b => b.subarray(0, 4));
      const isZip = fileHeader[0] === 0x50 && fileHeader[1] === 0x4B; // PK magic bytes
      if (isZip) {
        datPath = await this.extract(filePath, system.slug);
      } else {
        datPath = filePath;
      }
      if (!datPath) {
        failedSystems.push({ slug: system.slug, reason: 'extraction failed' });
        await fs.unlink(filePath).catch(() => {});
        continue;
      }

      const dat = await this.parse(datPath, system);
      if (dat) {
        dats.push(dat);
      } else {
        failedSystems.push({ slug: system.slug, reason: 'parse failed' });
      }
      if (remoteLoc) versionUpdates[system.slug] = remoteLoc;
      await fs.unlink(filePath).catch(() => {});
      if (datPath && datPath !== filePath) await fs.unlink(datPath).catch(() => {});
    }

    this._lastResult = { dats, downloaded, skipped: skippedSystems, failed: failedSystems, parsed: dats.length };

    console.log(`[fetcher] Fetch complete: ${downloaded} downloaded, ${skippedSystems.length} skipped, ${dats.length} parsed, ${failedSystems.length} failed`);
    if (failedSystems.length > 0) {
      console.warn(`[fetcher] Failed systems: ${failedSystems.map(f => `${f.slug} (${f.reason})`).join(', ')}`);
    }
    if (Object.keys(versionUpdates).length) await this.saveVersions(versionUpdates);
    return dats;
  }

  private getStoredVersionForSlug(slug: string): string | null {
    const info = this.versionTracker.read(this.getSourceName());
    const vs = (info as unknown as Record<string, Record<string, string>>)?.versions;
    return vs?.[slug] || null;
  }

  private async saveVersions(updates: Record<string, string>): Promise<void> {
    let data: Record<string, Record<string, unknown>> = {};
    try { data = JSON.parse((await fs.readFile('./versions.json', 'utf-8')).toString()); } catch {}
    const existing = (data['redump']?.versions as Record<string, string>) || {};
    // Merge: keep existing per-slug versions, overwrite only the slugs that changed
    const merged = { ...existing, ...updates };
    data['redump'] = { version: new Date().toISOString(), lastChecked: new Date().toISOString(), versions: merged };
    await fs.writeFile('./versions.json', JSON.stringify(data, null, 2) + '\n');
  }

  async close(): Promise<void> { if (this.browser) { await this.browser.close(); this.browser = null; } }
}

const isMain = import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') || '');
if (isMain) {
  const fetcher = new RedumpFetcher(new VersionTracker('./versions.json'));
  fetcher.fetchDats().then(d => { console.log(`Fetch: ${d.length} DATs`); return fetcher.close(); }).catch(async e => { console.error(e); await fetcher.close(); process.exit(1); });
}