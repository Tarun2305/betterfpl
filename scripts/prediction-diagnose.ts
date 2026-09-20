import { createClient } from '@supabase/supabase-js';
import initSqlJs from 'sql.js';
import { TypeSafeClient } from '@typesafe-ai/sdk';
import { predictionDiagnostic } from '../lib/prediction-worker';

// Storage is read-only. One explicit fixture replay can call Jev; retries are disabled.
const url = process.env.SUPABASE_URL;
const secret = process.env.SUPABASE_SECRET_KEY;
if (!url || !secret) throw new Error('Supabase credentials required');
const { data, error } = await createClient(url, secret, {
  auth: { persistSession: false, autoRefreshToken: false },
}).storage.from(process.env.SUPABASE_STORAGE_BUCKET || 'betterfpl-cache')
  .download('predictions/private/state.sqlite');
if (error || !data) throw new Error('Could not read prediction checkpoint');
const SQL = await initSqlJs();
const db = new SQL.Database(new Uint8Array(await data.arrayBuffer()));
try {
  const releaseId = process.env.DIAGNOSE_RELEASE;
  const rows = db.exec('SELECT namespace, id, body FROM records WHERE namespace IN (\'releases\', \'fixtures\')')[0]?.values ?? [];
  const replayId = process.env.DIAGNOSE_REPLAY_FIXTURE;
  if (replayId) {
    const found = rows.find(([namespace, id]) => namespace === 'fixtures' && id === `${releaseId}:${replayId}`);
    const record = found ? JSON.parse(String(found[2])) : undefined;
    if (!record?.request || record.status !== 'failed') throw new Error('Replay requires an explicitly rejected fixture');
    try {
      const response = await new TypeSafeClient({timeout:60000,retry:{maxRetries:0},logLevel:'off'}).systemOne(record.request);
      console.log(JSON.stringify({diagnosticReplay:'accepted',usage:response.usage,answers:Object.keys(response.answers).length}));
    } catch (failure) {
      console.log(JSON.stringify({diagnosticReplay:'rejected',...predictionDiagnostic(failure)}));
    }
  }
  for (const [namespace, id, body] of rows) {
    const record = JSON.parse(String(body));
    if (releaseId && record.releaseId !== releaseId && record.id !== releaseId) continue;
    console.log(JSON.stringify({namespace, id, status:record.status,
      errors:record.errors, error:record.error, checkedAt:record.checkedAt,
      estimatedTokens:record.estimatedTokens, usage:record.result?.usage,
      questions:record.request ? Object.keys(record.request.questions).length : undefined,
      requestBytes:record.request ? Buffer.byteLength(JSON.stringify(record.request)) : undefined,
    }));
  }
} finally { db.close(); }
