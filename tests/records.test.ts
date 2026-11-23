import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { FileStore, RECORDS_LIMIT, Records, UpstashStore, cleanEntry, type RecordEntry, type RecordsStore } from '../server/Records';
import { mergeTables, recordsUrl, rememberRecord, restoreRecords, savedRecords, savedTables } from '../src/net/records';

class MemoryStore implements RecordsStore {
  readonly tables = new Map<string, RecordEntry[]>();
  async load(robot: string) {
    return structuredClone(this.tables.get(robot) ?? []);
  }
  async save(robot: string, entries: RecordEntry[]) {
    this.tables.set(robot, structuredClone(entries));
  }
}

describe('high scores', () => {
  it('keeps one record per player: a better score replaces the old one, a worse one is ignored', async () => {
    const records = new Records(new MemoryStore());
    expect(await records.submit('skyline', 'Max', 200)).toEqual({ rank: 1, best: 200, improved: true });
    expect(await records.submit('skyline', 'Sasha', 220)).toMatchObject({ rank: 1, improved: true });
    expect(await records.submit('skyline', 'max', 150)).toEqual({ rank: 2, best: 200, improved: false });
    expect(await records.submit('skyline', 'Max', 250)).toEqual({ rank: 1, best: 250, improved: true });
    const top = await records.top('skyline');
    expect(top.map(e => [e.name, e.score])).toEqual([['Max', 250], ['Sasha', 220]]);
  });

  it('keeps separate tables per robot and only the top 100', async () => {
    const store = new MemoryStore();
    const records = new Records(store);
    for (let i = 0; i < RECORDS_LIMIT + 5; i++) await records.submit('skyline', `P${i}`, i);
    await records.submit('other', 'Max', 10);
    const top = await records.top('skyline');
    expect(top).toHaveLength(RECORDS_LIMIT);
    expect(top[0].score).toBe(RECORDS_LIMIT + 4);
    expect(top.at(-1)!.score).toBe(5);
    expect(await records.submit('skyline', 'Low', 1)).toMatchObject({ rank: null, improved: true });
    expect(store.tables.get('other')).toHaveLength(1);
  });

  it('handles submissions that arrive at the same time without losing any', async () => {
    const records = new Records(new MemoryStore());
    await Promise.all(['A', 'B', 'C', 'D'].map((n, i) => records.submit('skyline', n, 100 + i)));
    expect((await records.top('skyline')).map(e => e.name)).toEqual(['D', 'C', 'B', 'A']);
  });

  it('stores tables in a JSON file', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ursim-')), 'data', 'records.json');
    await new Records(new FileStore(file)).submit('skyline', 'Max', 120);
    const again = new Records(new FileStore(file));
    expect((await again.top('skyline'))[0]).toMatchObject({ name: 'Max', score: 120 });
  });

  it('talks to Upstash with GET / SET commands', async () => {
    const db = new Map<string, string>();
    const calls: string[][] = [];
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      const args = JSON.parse(String(init.body)) as string[];
      calls.push(args);
      const result = args[0] === 'GET' ? db.get(args[1]) ?? null : (db.set(args[1], args[2]), 'OK');
      return new Response(JSON.stringify({ result }));
    }) as typeof fetch;
    const records = new Records(new UpstashStore('https://example.upstash.io', 'token', fakeFetch));
    await records.submit('skyline', 'Max', 90);
    expect((await records.top('skyline'))[0].score).toBe(90);
    expect(calls.map(c => c[0])).toEqual(['GET', 'SET', 'GET']);
    expect(calls[0][1]).toBe('ursim:records:skyline');
  });

  it('puts back the rows a wiped table lost with their dates, keeping better scores it has', async () => {
    const records = new Records(new MemoryStore());
    await records.submit('skyline', 'Sasha', 80, new Date('2026-10-28T12:00:00Z'));
    await records.submit('skyline', 'Max', 40, new Date('2026-10-28T12:00:00Z'));
    const table = await records.restore('skyline', [
      { name: 'Nurtas', score: 305, date: '2026-10-27T15:00:00.000Z' },
      { name: 'sasha', score: 60, date: '2026-10-20T10:00:00.000Z' },
      { name: 'MAX', score: 90, date: '2026-10-21T10:00:00.000Z' },
    ]);
    expect(table.map(e => `${e.name} ${e.score} ${e.date.slice(0, 10)}`)).toEqual(['Nurtas 305 2026-10-27', 'MAX 90 2026-10-21', 'Sasha 80 2026-10-28']);
    expect(await records.submit('skyline', 'Nurtas', 200)).toEqual({ rank: 1, best: 305, improved: false });
  });

  it('accepts only real rows sent back', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    expect(cleanEntry({ name: '  Max  ', score: 120, date: '2026-10-01T00:00:00.000Z' }, now)).toEqual({ name: 'Max', score: 120, date: '2026-10-01T00:00:00.000Z' });
    expect(cleanEntry({ name: 'Max', score: 120, date: '2030-01-01T00:00:00.000Z' }, now)!.date).toBe(now.toISOString());
    expect(cleanEntry({ name: 'Max', score: 120, date: 'soon' }, now)!.date).toBe(now.toISOString());
    for (const bad of [null, {}, { name: ' ', score: 1 }, { name: 'Max', score: -1 }, { name: 'Max', score: 1.5 }, { name: 'Max', score: 99_999 }, { name: 'Max', score: '100' }]) {
      expect(cleanEntry(bad, now)).toBeNull();
    }
  });

  it('finds the records API on the game server', () => {
    expect(recordsUrl('https://ursim.onrender.com')).toBe('https://ursim.onrender.com/api/records');
    expect(recordsUrl('https://ursim.onrender.com', 'restore')).toBe('https://ursim.onrender.com/api/records/restore');
    expect(recordsUrl('http://localhost:8787/')).toBe('http://localhost:8787/api/records');
    // Addresses saved by versions with online rooms
    expect(recordsUrl('wss://ursim.onrender.com/ws')).toBe('https://ursim.onrender.com/api/records');
  });
});

describe('high scores kept in the browser', () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it("keeps each player's best per robot", () => {
    const storage = memory();
    rememberRecord('twin-flywheel', 'Max', 120, storage);
    rememberRecord('twin-flywheel', 'max', 90, storage);
    rememberRecord('twin-flywheel', 'Sasha', 50, storage);
    rememberRecord('twin-flywheel', 'MAX', 150, storage);
    expect(savedRecords(storage)['twin-flywheel']).toEqual([{ name: 'Sasha', score: 50 }, { name: 'MAX', score: 150 }]);
  });

  /** A records server in memory behind fetch; `posts` lists the rows each restore sent back. */
  async function withServer(server: Records, run: (posts: string[][]) => Promise<void>): Promise<void> {
    const posts: string[][] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      const robot = new URL(url).searchParams.get('robot');
      if (!init) return new Response(JSON.stringify({ robot, entries: await server.top(robot!) }));
      const body = JSON.parse(String(init.body)) as { robot: string; entries: RecordEntry[] };
      posts.push(body.entries.map(e => `${e.name} ${e.score}`));
      return new Response(JSON.stringify({ robot: body.robot, entries: await server.restore(body.robot, body.entries) }));
    }) as typeof fetch;
    const real = globalThis.fetch;
    globalThis.fetch = fake;
    try {
      await run(posts);
    } finally {
      globalThis.fetch = real;
    }
  }

  it('sends a restarted server the bests its table lost, and nothing it still has', async () => {
    const server = new Records(new MemoryStore());
    await server.submit('twin-flywheel', 'Sasha', 70);
    await withServer(server, async posts => {
      await restoreRecords('https://example.test', ['twin-flywheel', 'skyline'], { 'twin-flywheel': [{ name: 'Max', score: 228 }, { name: 'Sasha', score: 60 }] }, memory());
      expect(posts).toEqual([['Max 228']]);
    });
    expect((await server.top('twin-flywheel')).map(e => `${e.name} ${e.score}`)).toEqual(['Max 228', 'Sasha 70']);
  });

  it("brings back other players' records too: every browser keeps the tables it saw", async () => {
    const storage = memory();
    // Before the restart: another player's 300 is in the table this browser opens.
    const before = new Records(new MemoryStore());
    await before.submit('skyline', 'Nurtas', 305, new Date('2026-10-27T15:00:00Z'));
    await before.submit('skyline', 'Max', 120, new Date('2026-10-27T16:00:00Z'));
    await withServer(before, async () => {
      await restoreRecords('https://example.test', ['skyline'], {}, storage);
    });
    expect(savedTables(storage)['skyline'].map(e => e.name)).toEqual(['Nurtas', 'Max']);

    // The server restarted with an empty table and someone already played.
    const after = new Records(new MemoryStore());
    await after.submit('skyline', 'Dana', 150);
    await withServer(after, async posts => {
      const tables = await restoreRecords('https://example.test', ['skyline'], {}, storage);
      expect(posts).toEqual([['Nurtas 305', 'Max 120']]);
      expect(tables['skyline'].map(e => `${e.name} ${e.score}`)).toEqual(['Nurtas 305', 'Dana 150', 'Max 120']);
    });
    const top = await after.top('skyline');
    expect(top[0]).toEqual({ name: 'Nurtas', score: 305, date: '2026-10-27T15:00:00.000Z' });
  });

  it('merges tables into one row per player, best first, the earlier date on a tie', () => {
    const row = (name: string, score: number, date: string): RecordEntry => ({ name, score, date });
    expect(mergeTables(
      [row('Max', 100, '2026-10-02'), row('Sasha', 90, '2026-10-01')],
      [row('max', 100, '2026-10-01'), row('Sasha', 95, '2026-10-03'), row('Dana', 10, '2026-10-01')],
    )).toEqual([row('max', 100, '2026-10-01'), row('Sasha', 95, '2026-10-03'), row('Dana', 10, '2026-10-01')]);
  });
});
