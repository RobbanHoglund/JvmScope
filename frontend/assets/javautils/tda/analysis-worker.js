import { analyzeThreadDumpData } from './analysis.js';

self.onmessage = ({ data }) => {
    try {
        self.postMessage({ result: analyzeThreadDumpData(data.text, data.cpuThresholds) });
    } catch (error) {
        self.postMessage({ error: error?.message || 'Thread dump analysis failed.' });
    }
};
