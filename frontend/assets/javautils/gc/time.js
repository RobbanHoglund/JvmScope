/** Keep dates and elapsed days visible across long capture windows. */
export function formatGcTime(value, clock='uptime', {compact=false, span=0}={}) {
    if(!Number.isFinite(value))return 'No timestamp';
    if(clock==='wall') {
        const iso=new Date(value).toISOString();
        if(!compact)return iso.replace('T',' ');
        return span>=86400000?iso.slice(5,10)+' '+iso.slice(11,16):iso.slice(11,23);
    }
    if(value<60000)return `${(value/1000).toFixed(3)} s`;
    const days=Math.floor(value/86400000),hours=Math.floor(value/3600000)%24,minutes=Math.floor(value/60000)%60;
    const seconds=((value%60000)/1000).toFixed(3).padStart(6,'0');
    const hh=String(hours).padStart(2,'0'),mm=String(minutes).padStart(2,'0');
    return `${days?days+'d ':''}${hh}:${mm}${compact&&span>=3600000?'':':'+seconds}`;
}
