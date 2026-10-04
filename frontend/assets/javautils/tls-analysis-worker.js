import { analyzeTlsLog } from './tls-parser.js';
import { prepareTlsAnalysis } from './tls-analysis-model.js';

self.onmessage = ({ data }) => {
    try {
        const analysis = analyzeTlsLog(data.text);
        self.postMessage({ result: { analysis, entries: prepareTlsAnalysis(analysis.interactions) } });
    } catch (error) {
        self.postMessage({ error: error?.message || 'TLS analysis failed.' });
    }
};
