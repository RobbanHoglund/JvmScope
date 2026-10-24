import { parentPort, workerData } from 'node:worker_threads';
import { readCaptures, captureLines } from './captures.mjs';
import { analyzeThreads, analyzeTls, analyzeGarbageCollection } from './analysis.mjs';
import { searchKnowledge, knowledgeArticle } from './knowledge.mjs';

try {
    const started = performance.now();
    const { name, args } = workerData;
    let result;
    if (name === 'read_capture_lines') result = await captureLines(args);
    else if (name === 'search_knowledge') result = searchKnowledge(args);
    else if (name === 'get_knowledge_article') result = knowledgeArticle(args);
    else {
        const captures = await readCaptures(args.paths || [args.path]);
        const readFinished = performance.now();
        result = ({ analyze_thread_dumps: analyzeThreads, show_thread_example: analyzeThreads, analyze_tls_log: analyzeTls, analyze_gc_log: analyzeGarbageCollection })[name](captures, args);
        result.timing = { readMs: Math.round(readFinished - started), analysisMs: Math.round(performance.now() - readFinished) };
        if (name === 'show_thread_example') {
            // The fixed public example is small; return independently hash-checked source
            // evidence in this same worker to avoid another model/tool round trip.
            result.exampleEvidence = await captureLines({ path: captures[0].path,
                sha256: captures[0].sha256, startLine: 1, endLine: 200 });
        }
    }
    // Never silently truncate an evidence string or JSON result.
    if (JSON.stringify(result).length > 512 * 1024) throw new Error('Result exceeds the 512 KiB response limit. Reduce limit or select a smaller capture interval.');
    parentPort.postMessage({ result });
} catch (error) { parentPort.postMessage({ error: error.message }); }
