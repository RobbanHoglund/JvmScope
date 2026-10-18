import { parseGcLog } from './parser.js';
self.onmessage=({data})=>{try {self.postMessage({result:parseGcLog(data.text)});} catch(error) {self.postMessage({error:error.message});}};
