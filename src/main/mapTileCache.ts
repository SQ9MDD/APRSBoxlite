import * as fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { MapSource } from '../mapSettings';

const MAX_TILE_BYTES = 4 * 1024 * 1024;
const MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'];
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

export class MapTileCache {
  private readonly generations = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<Response>>();
  private readonly directory: () => string;
  private readonly getSources: () => MapSource[];
  private readonly fetchTile: (url: string) => Promise<Response>;
  constructor(
    directory: () => string,
    getSources: () => MapSource[],
    fetchTile: (url: string) => Promise<Response>,
  ) {
    this.directory = directory;
    this.getSources = getSources;
    this.fetchTile = fetchTile;
  }

  private sourceDirectory(id: string): string {
    return path.join(this.directory(), 'map-tiles', digest(id));
  }

  private findSource(id: string): MapSource | undefined {
    return this.getSources().find((source) => source.id === id);
  }

  async respond(requestUrl: string): Promise<Response> {
    let parsed: URL;
    try { parsed = new URL(requestUrl); } catch { return new Response(null, { status: 400 }); }
    const parts = parsed.pathname.split('/').slice(1);
    if (parsed.protocol !== 'aprsbox-tile:' || parsed.hostname !== 'tiles' || parts.length !== 4 || parsed.search || parsed.hash)
      return new Response(null, { status: 400 });
    let id: string;
    try { id = decodeURIComponent(parts[0]); } catch { return new Response(null, { status: 400 }); }
    if (!parts.slice(1).every((part) => /^(?:0|[1-9]\d*)$/.test(part))) return new Response(null, { status: 400 });
    const [z, x, y] = parts.slice(1).map(Number);
    const source = this.findSource(id);
    if (!source?.enabled || !source.cacheEnabled) return new Response(null, { status: 404 });
    if (z > 30 || z < source.minZoom || z > source.maxZoom || x >= 2 ** z || y >= 2 ** z) return new Response(null, { status: 400 });
    const file = path.join(this.sourceDirectory(id), digest(source.url), String(z), String(x), `${y}.tile`);
    const key = `${file}:${this.generations.get(id) ?? 0}`;
    let operation = this.inflight.get(key);
    if (!operation) {
      operation = this.readOrFetch(source, z, x, y, file, this.generations.get(id) ?? 0);
      this.inflight.set(key, operation);
      void operation.then(() => this.inflight.delete(key), () => this.inflight.delete(key));
    }
    return (await operation).clone();
  }

  private async readOrFetch(source: MapSource, z: number, x: number, y: number, file: string, generation: number): Promise<Response> {
    try {
      const stat = await fs.stat(file);
      if (stat.size < 2 || stat.size > MAX_TILE_BYTES + 1) throw new Error('Invalid cached tile.');
      const stored = await fs.readFile(file);
      const type = MIME_TYPES[stored[0]];
      if (!type) throw new Error('Invalid cached tile type.');
      return new Response(stored.subarray(1), { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
    } catch { /* Missing or unreadable tiles are fetched again. */ }
    const subdomain = ['a', 'b', 'c'][(x + y) % 3];
    const url = source.url.replaceAll('{z}', String(z)).replaceAll('{x}', String(x)).replaceAll('{y}', String(y)).replaceAll('{s}', subdomain);
    try {
      const response = await this.fetchTile(url);
      if (!response.ok) return new Response(null, { status: 502 });
      const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      const typeIndex = MIME_TYPES.indexOf(type);
      if (typeIndex < 0 || Number(response.headers.get('content-length')) > MAX_TILE_BYTES) return new Response(null, { status: 502 });
      if (!response.body) return new Response(null, { status: 502 });
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_TILE_BYTES) { await reader.cancel(); return new Response(null, { status: 502 }); }
        chunks.push(value);
      }
      if (!length) return new Response(null, { status: 502 });
      const body = Buffer.concat(chunks);
      if (generation === (this.generations.get(source.id) ?? 0)) {
        const temporary = `${file}.${randomUUID()}.tmp`;
        try {
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(temporary, Buffer.concat([Buffer.from([typeIndex]), body]));
          if (generation === (this.generations.get(source.id) ?? 0)) await fs.rename(temporary, file);
          else await fs.rm(temporary, { force: true });
        } catch (error) {
          await fs.rm(temporary, { force: true }).catch(() => undefined);
          console.error('Map tile cache write failed:', error);
        }
      }
      return new Response(body, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
    } catch (error) {
      console.error('Map tile download failed:', error);
      return new Response(null, { status: 502 });
    }
  }

  async stats(id: string): Promise<{ count: number; bytes: number }> {
    if (!this.findSource(id)) throw new Error('Map source not found.');
    let count = 0;
    let bytes = 0;
    const directories = [this.sourceDirectory(id)];
    while (directories.length) {
      const directory = directories.pop()!;
      let entries;
      try { entries = await fs.readdir(directory, { withFileTypes: true }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      for (const entry of entries) {
        const name = path.join(directory, entry.name);
        if (entry.isDirectory()) directories.push(name);
        else if (entry.isFile() && entry.name.endsWith('.tile')) {
          try { const stat = await fs.stat(name); count++; bytes += Math.max(0, stat.size - 1); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        }
      }
    }
    return { count, bytes };
  }

  async clear(id: string): Promise<void> {
    if (!this.findSource(id)) throw new Error('Map source not found.');
    const root = this.sourceDirectory(id);
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    const pending = [...this.inflight].filter(([key]) => key.startsWith(`${root}${path.sep}`)).map(([, value]) => value);
    await Promise.allSettled(pending);
    await fs.rm(root, { recursive: true, force: true });
  }
}
