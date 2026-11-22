import * as fs from 'node:fs/promises';
import { atomicWriteJson } from './configStorage';
import { replaceTocallDatabase } from './tocalls';

const URL = 'https://aprs-deviceid.aprsfoundation.org/tocalls.pretty.json';
const MAX_BYTES = 2 * 1024 * 1024;

export async function updateTocalls(fetcher: (url: string, options: RequestInit) => Promise<Response>, filePath?: string): Promise<{ count: number; generationTime?: string }> {
  const response = await fetcher(URL, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`TOCALL download failed (HTTP ${response.status}).`);
  if (Number(response.headers.get('content-length')) > MAX_BYTES || !response.body) throw new Error('Invalid TOCALL download size.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('TOCALL database is too large.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const contents = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), size).toString('utf8');
  const payload: unknown = JSON.parse(contents);
  const result = replaceTocallDatabase(payload, false);
  if (filePath) await atomicWriteJson(filePath, payload as Record<string, unknown>);
  replaceTocallDatabase(payload);
  return result;
}

export async function loadSavedTocalls(filePath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_BYTES * 4) throw new Error('TOCALL database is too large.');
    const contents = await fs.readFile(filePath, 'utf8');
    replaceTocallDatabase(JSON.parse(contents));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}
