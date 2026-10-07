import { GUIDES } from './guides.js';
import { queryTokens } from './search.js';

export const VERIFIED_DATE = '2026-10-05';
export const JAVA_VERSIONS = Array.from({length:21},(_,i)=>i+7);
const jep = id => `https://openjdk.org/jeps/${id}`;
const jcmd = 'https://docs.oracle.com/en/java/javase/27/docs/specs/man/jcmd.html';
const java = 'https://docs.oracle.com/en/java/javase/27/docs/specs/man/java.html';
const fileSchema = 'https://github.com/openjdk/jdk/blob/jdk-27-ga/src/jdk.management/share/classes/com/sun/management/doc-files/threadDump.html';
const release25 = 'https://www.oracle.com/java/technologies/javase/25-relnote-issues.html';
const release26 = 'https://www.oracle.com/java/technologies/javase/26-relnote-issues.html';
const release27 = 'https://www.oracle.com/java/technologies/javase/27-relnote-issues.html';
const checked = '2026-10-06';
const corrected = '2026-10-07';
const hotspot7Flags = 'https://github.com/openjdk/jdk7u/blob/jdk7u80-b15/hotspot/src/share/vm/runtime/globals.hpp';
const hotspot8Flags = 'https://github.com/openjdk/jdk8u/blob/jdk8-b132/hotspot/src/share/vm/runtime/globals.hpp';
export const SOURCE_TITLES = {
    [hotspot7Flags]: 'OpenJDK 7u80 HotSpot flag definitions',
    [hotspot8Flags]: 'OpenJDK 8 HotSpot flag definitions',
    [release25]: 'JDK 25 release notes: file-dump locks and deprecated class-pointer option',
    [release26]: 'JDK 26 release notes: park-blocker owner',
    [release27]: 'JDK 27 release notes: JSON schema v2 and obsolete class-pointer option',
    [fileSchema]: 'OpenJDK 27 JSON thread-dump schema',
    [jcmd]: 'JDK 27 jcmd commands and collection impact',
    [java]: 'JDK 27 Java options and effective defaults',
};

// Release transitions from primary sources. No vendor-wide/default inference.
export const FEATURES = [
    {id:'compact-strings',name:'Compact Strings',scope:'OpenJDK String implementation',sources:[jep(254),java],states:[{since:9,status:'Product; enabled by default',detail:'Latin-1 or UTF-16 backing bytes; not UTF-8.'}]},
    {id:'string-dedup',name:'String Deduplication',scope:'HotSpot G1; requires Java 8u20+, not every Java 8 update',sources:[jep(192),java],states:[{since:8,status:'Product; disabled by default; update/GC dependent',detail:'G1 introduced in 8u20. Other collectors/vendors require separate verification.'}]},
    {id:'virtual-threads',name:'Virtual threads',scope:'OpenJDK; supported ports/builds',sources:[jep(444)],states:[{since:19,status:'Preview',detail:'Java 19/20 preview; requires matching preview build/options.'},{since:21,status:'Final',detail:'Lightweight threads; not a faster CPU execution mechanism.'}]},
    {id:'monitor-unpinning',name:'Virtual-thread monitor unpinning',scope:'HotSpot supported ports',sources:[jep(491)],states:[{since:24,status:'Delivered',detail:'Synchronized blocking can unmount. Native/foreign-call pinning cases remain; old jdk.tracePinnedThreads guidance is obsolete.'}]},
    {id:'file-dump',name:'Thread.dump_to_file',scope:'HotSpot/OpenJDK jcmd',sources:[jep(425),jep(444),jcmd,fileSchema],states:[{since:19,status:'Preview-era plain / JSON dump',detail:'Introduced with JEP 425; target command availability and collection scope must be checked.',sources:[jep(425)],verifiedDate:checked},{since:21,status:'Plain / JSON file dump available',detail:'Captures virtual and platform threads; fields vary by schema/build. Does not supply CPU/allocation counters.',sources:[jep(444),'https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html'],verifiedDate:checked}]},
    {id:'file-dump-evidence',name:'File-dump thread and lock evidence',scope:'Upstream HotSpot; optional fields and separately sampled threads',sources:[release25,release26,fileSchema],states:[
        {since:19,status:'Stacks and identifiers; limited thread evidence',detail:'Do not expect the later per-thread time/state and lock records. No CPU/allocation counters.',sources:[jep(425),'https://docs.oracle.com/en/java/javase/21/core/virtual-threads.html'],verifiedDate:corrected},
        {since:25,status:'Per-thread time/state and lock information',detail:'Optional monitor and park-blocker records in plain text and JSON. A file-dump cycle is not a JVM-confirmed atomic deadlock. No CPU/allocation counters.',sources:[release25,'https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/jdk/internal/vm/ThreadDumper.java'],verifiedDate:corrected},
        {since:26,status:'Park-blocker owner evidence added',detail:'Adds owner information when parked on AbstractOwnableSynchronizer objects; not an owner for every wait. Keeps the Java 25 fields. No CPU/allocation counters.',sources:[release26],verifiedDate:checked},
    ]},
    {id:'file-dump-carrier',name:'File-dump JSON carrier identifier',scope:'Upstream HotSpot JSON only; not emitted in plain text',sources:['https://github.com/openjdk/jdk/blob/jdk-25-ga/src/java.base/share/classes/jdk/internal/vm/ThreadDumper.java'],states:[
        {since:19,status:'No carrier identifier in this format revision',detail:'Older file-dump JSON does not include the later mounted-thread carrier field.',sources:['https://github.com/openjdk/jdk/blob/jdk-24-ga/src/java.base/share/classes/jdk/internal/vm/ThreadDumper.java'],verifiedDate:corrected},
        {since:25,status:'Optional mounted virtual-thread carrier identifier',detail:'JSON may include carrier when the sampled virtual thread is mounted. Plain text does not emit this identifier; absence does not prove a permanent carrier relationship.',verifiedDate:corrected},
    ]},
    {id:'file-dump-json',name:'File-dump JSON identifiers and schema',scope:'Upstream HotSpot JSON; not the plain-text format',sources:[release27,fileSchema],states:[
        {since:19,status:'String identifiers; no formatVersion member',detail:'Process/thread identifiers and thread counts are JSON strings. Do not require formatVersion: 2 in an older capture.',sources:['https://github.com/openjdk/jdk/blob/jdk-26-ga/src/java.base/share/classes/jdk/internal/vm/ThreadDumper.java'],verifiedDate:checked},
        {since:27,status:'JSON schema v2; numeric identifiers',detail:'formatVersion: 2; process/thread identifiers and thread counts are numbers. Preserve unknown or missing fields rather than inventing values.',sources:[release27,fileSchema],verifiedDate:checked},
    ]},
    {id:'compact-headers',name:'Compact Object Headers',scope:'HotSpot 64-bit; target x64/AArch64, GC/heap/build constraints',sources:[jep(450),jep(519),jep(534),java],states:[{since:24,status:'Experimental; disabled by default',detail:'UnlockExperimentalVMOptions required for this experimental feature.',sources:[jep(450)],verifiedDate:checked},{since:25,status:'Product; disabled by default',detail:'No experimental unlock needed. Vendor backports/defaults can differ.',sources:[jep(519)],verifiedDate:checked},{since:27,status:'Product; enabled by default',detail:'JEP 534. Inspect actual VM flags and collector/heap constraints.',sources:[jep(534),java],verifiedDate:checked}]},
    {id:'class-pointer-option',name:'UseCompressedClassPointers option',scope:'HotSpot supported 64-bit builds; not UseCompressedOops',sources:[release25,release27],states:[
        {since:7,status:'Separate option unavailable in checked upstream Java 7',detail:'The checked OpenJDK 7u80 flags include UseCompressedOops, not a separate UseCompressedClassPointers switch. Vendor backports remain unverified. This does not establish that class-pointer compression itself is absent.',sources:[hotspot7Flags],verifiedDate:corrected},
        {since:8,status:'Configuration-dependent option',detail:'The separate UseCompressedClassPointers switch is present in the checked upstream Java 8 flag definitions. Verify the actual supported 64-bit build and configuration; this is distinct from UseCompressedOops and compact headers.',sources:[hotspot8Flags],verifiedDate:corrected},
        {since:25,status:'Deprecated',detail:'The class-pointer configuration switch is deprecated; compression and compact headers remain distinct mechanisms.',sources:[release25],verifiedDate:checked},
        {since:27,status:'Obsolete; option ignored',detail:'HotSpot always compresses class pointers. Passing UseCompressedClassPointers emits a warning and does not change the mode.',sources:[release27],verifiedDate:checked},
    ]},
    {id:'unified-gc',name:'Unified GC logging',scope:'HotSpot',sources:[jep(271)],states:[{since:9,status:'Delivered; explicit logging configuration',detail:'-Xlog replaces earlier GC logging conventions; text formats change.'}]},
    {id:'g1-default',name:'G1 default collector',scope:'Upstream HotSpot; defaults vary by release; explicit collector selection overrides ergonomics',sources:[jep(248),jep(523)],states:[{since:9,status:'Default on specified server configurations',detail:'Through JDK 26, constrained environments can still select Serial GC. Verify the actual VM/build and flags.',sources:[jep(248)]},{since:27,status:'Default in all environments',detail:'JEP 523 extends the upstream HotSpot default to constrained and single-processor environments. Explicit collector flags still override it; vendor builds require verification. This is not a recommendation for every workload.',sources:[jep(523)]}]},
];

export function featureState(feature, version) {
    if(!JAVA_VERSIONS.includes(Number(version))) return {status:'Outside verified metadata range',detail:'Choose Java 7–27; no extrapolated claims.'};
    const state=feature.states.filter(s=>s.since<=Number(version)).at(-1);
    return state ? {...state,sources:state.sources||feature.sources,verifiedDate:state.verifiedDate||VERIFIED_DATE}
        : {status:'Not introduced in this version',detail:'No vendor backport claim.',sources:feature.sources,verifiedDate:VERIFIED_DATE};
}
export function compareVersions(from,to) {
    return FEATURES.map(feature=>({feature,from:featureState(feature,from),to:featureState(feature,to)}))
        .filter(row=>row.from.status!==row.to.status || row.from.detail!==row.to.detail);
}
export function filterArticles({query='',version='',topic=''}={}) {
    const needle=String(query).toLowerCase().trim();
    if(needle.length>512) return [];
    const tokens=queryTokens(query);
    if(needle && !tokens.length) return [];
    const textTokens=text=>String(text).toLowerCase().match(/[\p{L}\p{N}_]+/gu)||[];
    const blockText=blocks=>Object.values(blocks||{}).flat().flatMap(b=>[b.text,b.title,b.caption,...(b.items||[]),...(b.headers||[]),...(b.rows||[]).flat()]).filter(Boolean).join(' ');
    return ARTICLES.filter(a=>(!version || JAVA_VERSIONS.includes(Number(version)) && Number(version)>=a.minVersion)
        && (!topic || a.topics.includes(topic))).map((article,index)=>{
        const title=textTokens(article.title);
        const features=FEATURES.filter(f=>article.features.includes(f.id));
        const terms=textTokens([article.searchTerms||'',...features.map(f=>f.name)].join(' '));
        const body=textTokens([article.summary,...['does','versions','benefits','limits','check','measure'].map(k=>article[k]),blockText(article.blocks),...features.flatMap(f=>[f.scope,...f.states.map(s=>`${s.status} ${s.detail}`)]),...JAVA_VERSIONS.filter(v=>v>=article.minVersion).map(v=>`Java ${v}`)].join(' '));
        const matches=(words,t)=>words.some(w=>/^\d+$/.test(t)?w===t:w.includes(t));
        if(!tokens.every(t=>matches([...title,...terms,...body],t)))return null;
        const score=(needle && article.title.toLowerCase().includes(needle)?100:0)+tokens.reduce((n,t)=>n+(matches(title,t)?8:matches(terms,t)?4:1),0);
        return {article,index,score};
    }).filter(Boolean).sort((a,b)=>b.score-a.score||a.index-b.index).map(row=>row.article);
}

// This is upstream collection guidance, not vendor certification or parsed data.
export function collectionEvidence({format,version,vm='hotspot'}={}) {
    const unknown=!JAVA_VERSIONS.includes(Number(version)) || vm!=='hotspot';
    const noCounters='No CPU/allocation counters in file dumps. Separately sampled threads do not establish an atomic deadlock.';
    if(!['classic','plain','json','tls'].includes(format))return {available:null,status:'Unknown format',detail:'Choose a documented collection format.',facts:[]};
    if(unknown)return {available:null,status:'Availability not established',detail:'Select Java 7–27 and verify the actual VM/provider, command help and schema. No upstream metadata is extrapolated to unknown runtimes.',facts:[]};
    if(format==='classic')return {available:true,status:'Classical HotSpot format family',detail:`Java ${Number(version)}: stacks, states and printed lock ownership. CPU/elapsed/allocation only if actually supplied. Check the target Thread.print -l/-e help; virtual-thread scope varies by build.`,facts:[]};
    if(format==='tls')return {available:true,status:'SunJSSE provider-specific evidence',detail:'Actual provider, debug options and log format determine fields. Thread grouping is not a connection identifier; partial or contradictory handshakes can remain unknown. A Java version does not certify every provider.',facts:[]};
    if(Number(version)<19)return {available:false,status:`Not available in upstream Java ${Number(version)}`,detail:`Thread.dump_to_file was introduced in Java 19. Use the classical Thread.print/jstack format on this version; verify vendor backports separately. ${noCounters}`,facts:[]};
    const ids=['file-dump','file-dump-evidence',...(format==='json'?['file-dump-carrier','file-dump-json']:[])];
    const facts=ids.map(id=>({feature:FEATURES.find(f=>f.id===id),state:featureState(FEATURES.find(f=>f.id===id),version)}));
    return {available:true,status:`${format==='json'?'JSON':'Plain-text'} file dump · Java ${Number(version)}`,detail:`${facts.map(f=>`${f.state.status}. ${f.state.detail}`).join(' ')} ${Number(version)<21?'Java 19/20 virtual-thread APIs are preview; check matching build/options. The diagnostic command itself is not an instruction to enable preview. ':''}${noCounters}`,facts};
}

export const ARTICLES = [
    {id:'thread-dumps',title:'Collect the right thread dump',minVersion:7,topics:['diagnostics','threads'],features:['file-dump','file-dump-evidence','file-dump-carrier','file-dump-json'],sources:[jcmd,fileSchema,jep(444),release25,release26,release27],verifiedDate:corrected,blocks:GUIDES['thread-dumps'],collection:true,
        summary:'Match collection scope and format to the question; a text filename does not identify the diagnostic format.',
        does:'jstack and jcmd Thread.print produce classical HotSpot text with stacks and available lock observations. Thread.print -l requests ownable synchronizers; -e requests extended information where supported. These commands do not produce the same layout as Thread.dump_to_file plain text.',
        versions:'Java 7–27 classical format families are a JvmScope target, not universal vendor certification. File-dump command availability, per-thread evidence and JSON identifier types are separate capabilities in the selected-version table. Their release transitions are shared with the upgrade comparison. Check section B for the selected runtime and format.',
        benefits:'Use classical dumps for explicit platform-thread lock ownership and CPU counters when actually printed. Use file dumps to see virtual-thread workloads, including threads not mounted when sampled. A sequence from the same incident can reveal repeated observed dependencies without a historical baseline.',
        limits:'File dump threads are sampled separately: a graph cycle is not an atomic JVM-confirmed deadlock. File dumps lack CPU/allocation counters. Unobserved threads/fields are not zero values. Different VM families or vendor updates can differ; do not infer an owner from Object.wait notification waits.',
        check:'Record java -version, VM/vendor, host/process context, collection command and its options. Ask the target with jcmd <pid> help Thread.print and help Thread.dump_to_file. Keep source timestamps and the PID prefix. Use the target JDK tools and access requirements; collection has runtime impact.',
        measure:'Compare parsing warnings, scope and raw evidence before interpreting changes. For lock problems collect multiple comparable dumps while the symptom occurs. For CPU or latency add a timed CPU profile/JFR and request traces; a stack alone cannot establish cost.',
    },
    {id:'thread-counters',title:'CPU, elapsed and allocation: evidence and limits',minVersion:7,topics:['diagnostics','performance','threads'],features:[],sources:[jcmd,'https://docs.oracle.com/en/java/javase/25/docs/api/jdk.management/com/sun/management/ThreadMXBean.html','https://docs.oracle.com/en/java/javase/25/docs/api/java.management/java/lang/management/ThreadMXBean.html'],collection:true,searchTerms:'CPU allocation thread counters allocation rate',
        summary:'A cumulative counter is not a rate, and RUNNABLE does not establish CPU usage.',
        does:'Thread CPU counters accumulate execution time. Allocated-byte counters describe cumulative thread allocation, not retained/live heap. Elapsed time, when supplied, provides lifetime/interval evidence. Rates need compatible adjacent identities, increasing counters and a usable interval.',
        versions:'The HotSpot header fields are optional and command/build dependent across Java 7–27; this article does not invent an introduction version for each printed field. ThreadMXBean CPU support may be unavailable/disabled; com.sun.management allocation support is an implementation extension. The platform ThreadMXBean does not provide a general virtual-thread CPU inventory.',
        benefits:'Comparable counters can separate a busy thread from a stack that merely looks computational. Allocation rates help locate allocation producers, then a heap/profile can test whether the objects survive. JvmScope measures only intervals supported by the input.',
        limits:'Missing counters are unknown. Rounded/coarse clocks can give estimates; inconsistent clocks do not give reliable measured chart points. An elapsed decrease beyond printed resolution or conflicting process evidence breaks continuity even if thread IDs match. Matching PID values are not global identity across hosts, namespaces or restarts.',
        check:'Look at the actual raw header: cpu=, elapsed=, allocated= and their precision. Check collector/JVM timestamps and provenance. For API measurements query support/enabled state on the actual VM. Plain/JSON Thread.dump_to_file does not acquire these counters just because the Java release is newer.',
        measure:'Collect adjacent comparable observations with adequate time resolution. Validate rates against a CPU profiler/JFR and process CPU measurements. Check allocation totals/rates against an allocation profile and retained-heap evidence; do not tune memory using one thread dump.',
    },
    {id:'virtual-threads',title:'Virtual threads, carriers and pinning',minVersion:19,topics:['threads','performance','diagnostics'],features:['virtual-threads','monitor-unpinning','file-dump','file-dump-evidence','file-dump-carrier','file-dump-json'],sources:[jep(444),jep(491),fileSchema],collection:true,searchTerms:'virtual threads VT carriers pinning',
        summary:'Distinguish scalable waiting, carrier observations and remaining pinning cases.',
        does:'Virtual threads allow many blocking tasks to share platform carriers. Mounted is an observation of execution on a carrier; it is not a permanent ownership relationship. Virtual threads improve concurrency for waiting workloads, not CPU speed or the number of available cores.',
        versions:'Preview in Java 19/20; final in 21. In 21–23, synchronized blocking can pin a carrier. JEP 491 in 24 changes monitor handling so these operations can unmount; native/foreign frames can still prevent unmounting. Old blanket advice to replace synchronized or use jdk.tracePinnedThreads is not applicable to 24+.',
        benefits:'File dumps and JFR help inspect large virtual-thread populations and bottlenecks without treating carriers as the entire workload. Explicit carrier IDs and lock records in newer schemas can provide concrete snapshot relationships.',
        limits:'A carrier may host different virtual threads at separate sample times. Repeated stack samples do not prove stalled progress, continuous pinning or CPU heat. Native calls and resource limits need separate evidence. Virtual-thread abundance does not remove database/connection-pool capacity limits.',
        check:'Record runtime build and schema. Check actual JFR event settings and jdk.VirtualThreadPinned events for duration/reason on that release. Inspect the target jcmd help for file dumps/scheduler diagnostics. Do not assume every vendor/backport matches the upstream transition.',
        measure:'Compare throughput and latency under representative waiting load, carrier CPU and pin-event duration; also measure downstream resource queues. Test before/after on the target build. JvmScope preserves observable carrier/lock evidence but does not provide a pin-duration profile.',
    },
    {id:'string-interning',title:'String interning and application caches',minVersion:7,topics:['memory','performance'],features:[],sources:['https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html','https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Map.html'],
        summary:'Canonicalization and caching have different ownership and lifetime tradeoffs.',
        does:'String.intern returns the canonical equal string from the string pool; callers must use the returned reference for canonicalization. A Map-based application cache stores references according to application policy and can cache more than strings. Neither facility diagnoses an application memory problem.',
        versions:'String.intern and Map are available throughout the Java 7–27 target range. The API contract is not a promise of the same pool implementation, capacity or performance across VMs/builds. No cache default, eviction or concurrency strategy is supplied by this article.',
        benefits:'Canonicalization can help when many long-lived equal strings really dominate the retained heap. A bounded cache may avoid repeated expensive construction or lookups for a small, reused key set. Measure hit rate and avoided work rather than assuming duplicates imply a useful cache.',
        limits:'High-cardinality user input can grow an application cache without bound. Strongly retained keys/values outlive otherwise temporary objects; weak/soft references change semantics and are not a free eviction policy. Interning does not eliminate the allocation cost of already constructing an input string.',
        check:'Inspect heap dominators, retained strings/backing arrays, cache ownership/size limits and key cardinality. Define eviction, lifetime, synchronization and correctness requirements before introducing a cache. Do not use object reference equality in place of String.equals unless the full canonicalization contract is established.',
        measure:'Compare retained heap, allocation rate, GC work, cache hit/eviction rates, construction cost and latency on representative input cardinality. A thread dump cannot justify interning or a string cache. Heap inspection can expose secrets: use controlled captures and review access/sharing.',
    },
    {id:'string-memory',title:'String Deduplication versus Compact Strings',minVersion:8,topics:['memory','gc','performance'],features:['string-dedup','compact-strings'],sources:[jep(192),jep(254),java],
        summary:'Sharing duplicate backing storage and using denser encoding solve different problems.',
        does:'String Deduplication shares backing storage between equal strings without making the String objects identical. Compact Strings use Latin-1 bytes when representable and UTF-16 bytes otherwise; this is not UTF-8. They can coexist, but neither is String.intern or an application cache.',
        versions:'G1 deduplication arrived in Java 8u20 and is disabled by default; Java 8 alone does not establish the required update. Additional collector/provider support requires separate validation. Compact Strings arrived in OpenJDK 9 and are enabled by default; verify actual flags/backports.',
        benefits:'Deduplication can save retained duplicate backing arrays. Compact Strings can reduce storage for Latin-1 content even without duplicates. Potential savings depend on the live string population and representation, not merely the allocation rate.',
        limits:'Deduplication adds bookkeeping/work and may save little with short-lived or mostly unique strings. Savings do not guarantee improved latency/throughput. Oracle’s Java command documentation describes G1 support; this is not a certification of every collector/vendor combination. Do not blindly turn flags on from a thread dump.',
        check:'Use jcmd <pid> VM.flags -all or the exact build’s PrintFlagsFinal to inspect UseStringDeduplication, CompactStrings and selected GC. Check target documentation and runtime warnings. Use a retained-heap sample to quantify equal backing data and dedup statistics where supported.',
        measure:'Measure live-set change, dedup bookkeeping, allocation/GC CPU, throughput and latency before/after under the same workload. Compact Strings benefits depend on character distribution. Compare total memory, not a theoretical percentage multiplied by every String object.',
    },
    {id:'object-headers',title:'Compact headers, compressed oops and class pointers',minVersion:7,topics:['memory','performance'],features:['compact-headers','class-pointer-option'],sources:[jep(450),jep(519),jep(534),java,release25,release27,'https://docs.oracle.com/javase/8/docs/technotes/guides/vm/performance-enhancements-7.html'],verifiedDate:corrected,blocks:GUIDES['object-headers'],searchTerms:'object headers object layout compressed references UseCompactObjectHeaders UseCompressedOops UseCompressedClassPointers',
        summary:'Object headers and reference encodings are different parts of object layout.',
        does:'Compact Object Headers reduce HotSpot header size on supported 64-bit targets. Compressed oops encode object references; compressed class pointers encode metadata references. These are related layout mechanisms, not interchangeable switches or guarantees about every object size.',
        versions:'Compact headers: experimental/off in JDK 24 (JEP 450), product/off in 25–26 (JEP 519), default on in 27 (JEP 534). Vendor backports/defaults can differ. Compressed-reference mechanisms predate compact headers and depend on VM architecture, heap and collector; their availability is not inferred solely from the major version.',
        benefits:'Smaller layouts may improve heap footprint and cache locality in object-dense applications. Header savings depend on alignment and payload: a smaller header may or may not reduce the aligned size of a specific object.',
        limits:'GC forwarding, identity hashes, locking, heap size and class-pointer capacity impose constraints. JEP 450 targets x64/AArch64 and describes large-heap constraints; do not extrapolate to every port/vendor/GC. Reference compression and compact headers do not replace a retained-heap investigation.',
        check:'Inspect the target VM flags and startup information for compact headers, object-reference compression, object alignment, heap size and collector. UseCompressedClassPointers is deprecated in HotSpot 25–26 and obsolete/ignored in 27; it is not a current mode switch in 27. Keep class-pointer compression separate from UseCompressedOops and check the exact vendor/build.',
        measure:'Measure actual aligned object sizes/live set, process memory, GC frequency, throughput and latency on a representative object population. An upgrade comparison identifies configuration changes to test; it does not promise the user a speedup.',
    },
    {id:'gc-memory',title:'GC, heap and process memory before tuning',minVersion:7,topics:['gc','memory','diagnostics'],features:['unified-gc','g1-default'],sources:[jep(271),jep(248),jep(523),jcmd,'https://docs.oracle.com/en/java/javase/25/gctuning/introduction-garbage-collection-tuning.html'],
        summary:'Heap use, native memory and resident process memory are not the same measurement.',
        does:'The heap holds Java objects; process memory also includes stacks, code, metadata, native allocations and mapped/shared regions. Reserved and committed VM memory differ from OS residency and container-accounted memory. GC logs describe collector activity, not all causes of response latency.',
        versions:'Across Java 7–27 use target-specific collection guidance. JDK 9 introduced unified GC logging (JEP 271) and G1 became default on specified server configurations (JEP 248). In JDK 27, JEP 523 makes G1 the upstream HotSpot default in all environments, including constrained and single-processor configurations that could previously select Serial GC. Explicit collector flags override this default; verify vendor/build differences. Older logging flags and parsers cannot be assumed compatible with -Xlog output.',
        benefits:'GC logs, allocation profiles, heap histograms/dumps and native-memory measurements answer different questions. Correlate observed pauses with latency before choosing a tuning experiment. An incident-local set of captures is useful without a historical reference bank.',
        limits:'A large heap does not prove a leak; total process memory does not equal live objects. Native Memory Tracking must be enabled/configured on the target and does not account for every allocation by arbitrary native code. Heap dumps/histograms can be costly and expose sensitive data.',
        check:'Record effective GC, heap/container limits, runtime flags and workload. Inspect jcmd help for GC.heap_info, GC.class_histogram and VM.native_memory. Check target documentation for NMT and logging impact; do not assume a command or collector exists on every VM.',
        measure:'Measure live set over collections, allocation rate, pause distributions, GC CPU, process RSS/container memory and workload latency/throughput. Tune one supported variable at a time in a controlled test. JvmScope has no GC log analysis engine in this delivery.',
    },
    {id:'upgrade-checklist',title:'Upgrade checklist: verify, compare, measure',minVersion:7,topics:['upgrades','diagnostics','performance'],features:['compact-strings','virtual-threads','monitor-unpinning','file-dump','file-dump-evidence','file-dump-carrier','file-dump-json','compact-headers','class-pointer-option','unified-gc','g1-default'],sources:[java,jcmd,jep(491),jep(534),'https://docs.oracle.com/en/java/javase/27/migrate/'],collection:true,
        summary:'An upgrade changes capabilities and defaults, not just a version number.',
        does:'Compare documented feature transitions for the chosen versions, then test the exact vendor/build/OS/collector combination. The local comparison uses the same structured facts as these articles. It is a shortlist of potential changes, not a complete migration checker.',
        versions:'Java 7–27 is the metadata target, not general certification. Major releases do not describe all update fixes, backports, security/provider policy or removed vendor flags. The generated JvmScope capture matrix remains the authority for tested builds and scenarios; it is not rewritten by the knowledge base.',
        benefits:'Plan collection changes (file dumps, clocks, logging), interpret newer virtual-thread evidence and inspect defaults such as compact headers. Record source and target flags before assuming the same runtime configuration survived an upgrade.',
        limits:'No inferred application performance gains, no automatic flag recommendations and no universal list of removed flags. Missing metadata is a verification gap. Library/native compatibility, TLS trust/protocol policy and deployment limits require tests of the application itself.',
        check:'Read the exact vendor migration/release notes and run controlled startup/functional/security tests. Compare VM.flags -all, selected GC, provider/runtimeVersion, architecture and diagnostic command help. Confirm that requested flags were accepted, not silently ignored or made obsolete.',
        measure:'Run the same representative workload with defined CPU, live-set/RSS, allocation, latency, throughput and pause measurements. Keep separate incident captures and compare supported measurements without declaring stack changes useful progress. GC analysis and TLS certificate-selection improvements are future directions, not links to available tools.',
    },
];
