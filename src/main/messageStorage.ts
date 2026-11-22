import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { AprsMessage } from '../types';

const MAX_MESSAGES = 1000;
const MAX_FILE_SIZE = 10 * 1024 * 1024;

function isMessage(value: unknown): value is AprsMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return ['id', 'sender', 'recipient', 'text', 'path', 'interfaceId', 'createdAt'].every((key) => typeof item[key] === 'string') &&
    (item.direction === 'rx' || item.direction === 'tx') &&
    ['received', 'pending', 'sent', 'acked', 'rejected', 'failed'].includes(String(item.status)) &&
    typeof item.attempts === 'number' && Number.isInteger(item.attempts) && item.attempts >= 0 &&
    Number.isFinite(Date.parse(item.createdAt as string)) &&
    (item.number === undefined || typeof item.number === 'string') &&
    (item.error === undefined || typeof item.error === 'string');
}

export class MessageStorage {
  private readonly file: string;
  private pending: Promise<void> = Promise.resolve();
  private lastError: unknown;

  constructor(userDataDirectory: string) {
    this.file = path.join(userDataDirectory, 'messages.json');
  }

  async load(): Promise<AprsMessage[]> {
    let raw: string;
    try {
      const stat = await fs.stat(this.file);
      if (stat.size > MAX_FILE_SIZE) throw new Error('Message history file is too large.');
      raw = await fs.readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid message history.');
    const record = data as Record<string, unknown>;
    if (record.version !== 1 || !Array.isArray(record.messages) || !record.messages.every(isMessage))
      throw new Error('Invalid message history.');
    return record.messages.slice(-MAX_MESSAGES);
  }

  save(messages: AprsMessage[]): Promise<void> {
    const snapshot = structuredClone(messages.slice(-MAX_MESSAGES));
    const operation = this.pending.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify({ version: 1, messages: snapshot }), { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporary, this.file);
      } catch (error) {
        await fs.rm(temporary, { force: true }).catch(() => undefined);
        throw error;
      }
    });
    this.pending = operation.then(() => { this.lastError = undefined; }, (error) => { this.lastError = error; });
    return operation;
  }

  async flush(): Promise<void> {
    await this.pending;
    if (this.lastError) throw this.lastError;
  }
}
