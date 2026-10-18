// Real controlled HotSpot output; capture commands and hashes live in testdata/gc-logs.
export const GC_EXAMPLES=Object.freeze([
    {id:'g1',name:'java27-g1.log',url:new URL('../../../../testdata/gc-logs/java27-g1.log',import.meta.url).href},
    {id:'legacy',name:'java8-parallel.log',url:new URL('../../../../testdata/gc-logs/java8-parallel.log',import.meta.url).href},
    {id:'zgc',name:'java27-zgc.log',url:new URL('../../../../testdata/gc-logs/java27-zgc.log',import.meta.url).href},
    {id:'shenandoah',name:'java17-shenandoah.log',url:new URL('../../../../testdata/gc-logs/java17-shenandoah.log',import.meta.url).href},
]);
