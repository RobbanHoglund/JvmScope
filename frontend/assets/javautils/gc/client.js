import { createGcWorker } from '../host/workers.js';
export function createGcClient(createWorker=createGcWorker) {
    let pending;
    function cancel(){if(pending){pending.worker.terminate();pending.resolve(null);pending=null;}}
    function analyze(text){cancel();return new Promise((resolve,reject)=>{
        const worker=createWorker(),job={worker,resolve};pending=job;
        const finish=(error,result)=>{if(pending!==job)return;pending=null;worker.terminate();error?reject(error):resolve(result);};
        worker.onmessage=({data})=>data?.error?finish(new Error(data.error)):Array.isArray(data?.result?.events)?finish(null,data.result):finish(new Error('Invalid GC worker response.'));
        worker.onerror=event=>{event.preventDefault?.();finish(new Error(event.message||'GC analysis failed.'));};
        worker.onmessageerror=()=>finish(new Error('GC worker response could not be read.'));
        try{worker.postMessage({text});}catch(error){finish(error);}
    });}
    return {analyze,cancel};
}
