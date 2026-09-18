import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const next=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'dev',...process.argv.slice(2)],{stdio:'inherit',windowsHide:true});
const worker=spawn(process.execPath,['--import','tsx','scripts/prediction-worker.ts','--watch'],{stdio:'inherit',windowsHide:true});
let closing=false;
function close(code=0) { if (closing) return; closing=true; next.kill(); worker.kill(); process.exitCode=code; }
next.on('exit',code=>close(code ?? 0)); worker.on('error',error=>console.error('Prediction scheduler could not start:',error.message));
process.on('SIGINT',()=>close()); process.on('SIGTERM',()=>close());
