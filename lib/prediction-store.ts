import { mkdir, readFile, writeFile, rename, unlink, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import initSqlJs, { type Database } from 'sql.js';

export const predictionDirectory = () => resolve(process.cwd(),'work','prediction-engine');
let runtime: ReturnType<typeof initSqlJs> | undefined;
async function sqlite() {
  runtime ??= readFile(resolve(process.cwd(),'node_modules/sql.js/dist/sql-wasm.wasm')).then(bytes=>initSqlJs({ wasmBinary:new Uint8Array(bytes).buffer }));
  return runtime;
}
// Single-writer snapshots keep SQLite portable across the existing Node versions.
// The worker holds the filesystem lock for every mutation; web readers never write.
export class PredictionStore {
  private constructor(private db: Database, private directory: string, private persist?: (bytes: Uint8Array)=>Promise<void>) {}
  static async open(directory = predictionDirectory(), persist?: (bytes: Uint8Array)=>Promise<void>) {
    const SQL = await sqlite();
    let bytes: Buffer | undefined;
    try { bytes = await readFile(resolve(directory,'predictions.sqlite')); } catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const db = bytes ? new SQL.Database(bytes) : new SQL.Database();
    db.run('CREATE TABLE IF NOT EXISTS records (namespace TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(namespace,id))');
    return new PredictionStore(db,directory,persist);
  }
  get<T>(namespace: string,id: string): T | undefined {
    const rows = this.db.exec('SELECT body FROM records WHERE namespace=? AND id=?',[namespace,id]);
    return rows[0]?.values[0] ? JSON.parse(String(rows[0].values[0][0])) as T : undefined;
  }
  all<T>(namespace: string): T[] { return (this.db.exec('SELECT body FROM records WHERE namespace=?',[namespace])[0]?.values ?? []).map(row=>JSON.parse(String(row[0])) as T); }
  put(namespace: string,id: string,body: unknown) { this.db.run('INSERT OR REPLACE INTO records(namespace,id,body) VALUES (?,?,?)',[namespace,id,JSON.stringify(body)]); }
  async save() {
    await mkdir(this.directory,{recursive:true});
    const temp = resolve(this.directory,`predictions.${process.pid}.tmp`);
    const bytes=this.db.export();
    // Cloud durability must succeed BEFORE the caller can send a paid request.
    if (this.persist) await this.persist(bytes);
    await writeFile(temp,bytes);
    await rename(temp,resolve(this.directory,'predictions.sqlite'));
  }
  close() { this.db.close(); }
}
export async function lockPredictions(directory = predictionDirectory()) {
  await mkdir(directory,{recursive:true});
  const path = resolve(directory,'worker.lock');
  for (let attempt=0;attempt<2;attempt++) {
    try {
      const handle = await open(path,'wx');
      await handle.writeFile(String(process.pid)); await handle.close();
      return async () => { await unlink(path); };
    } catch(error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const pid = Number(await readFile(path,'utf8'));
      if (!Number.isInteger(pid) || pid <= 0) throw new Error('Invalid worker lock; inspect it before removing it.');
      try { process.kill(pid,0); throw new Error('Another prediction worker is active.'); }
      catch(checkError) { if ((checkError as NodeJS.ErrnoException).code !== 'ESRCH') throw checkError; }
      await unlink(path);
    }
  }
  throw new Error('Could not claim worker lock');
}
