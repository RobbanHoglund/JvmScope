import { parentPort, workerData } from 'node:worker_threads';
import { readCaptures, captureLines } from './captures.mjs';
import { analyzeThreads, analyzeTls, analyzeGarbageCollection } from './analysis.mjs';
import { searchKnowledge, knowledgeArticle } from './knowledge.mjs';

try {
    const { name, args } = workerData;
    let result;
    if (name === 'read_capture_lines') result = await captureLines(args);
    else if (name === 'search_knowledge') result = searchKnowledge(args);
    else if (name === 'get_knowledge_article') result = knowledgeArticle(args);
    else {
        const captures = await readCaptures(args.paths || [args.path]);
        result = ({ analyze_thread_dumps: analyzeThreads, analyze_tls_log: analyzeTls, analyze_gc_log: analyzeGarbageCollection })[name](captures, args);
    }
    // Never silently truncate an evidence string or JSON result.
    if (JSON.stringify(result).length > 512 * 1024) throw new Error('Result exceeds the 512 KiB response limit. Reduce limit or select a smaller capture interval.');
    parentPort.postMessage({ result });
} catch (error) { parentPort.postMessage({ error: error.message }); }
