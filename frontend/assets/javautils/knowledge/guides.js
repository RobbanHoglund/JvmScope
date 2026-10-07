// Teaching blocks contain text, never author-supplied HTML. Layout calculations
// are illustrative; the renderer labels them separately from real capture data.
export const GUIDES = {
    'thread-dumps': {
        does: [
            {type:'table',caption:'Choose the question before the filename',headers:['Question','Collect','Important blind spot'],rows:[
                ['Which platform threads depend on a lock owner?','jcmd PID Thread.print -l, with -e only when target help supports it','Not an inventory of all unmounted virtual threads.'],
                ['Which virtual tasks and stacks were observed?','Thread.dump_to_file plain/JSON where available','No per-thread CPU/allocation counters; threads are sampled separately.'],
                ['Which thread consumed CPU during the symptom?','Comparable timed counters plus a CPU profile/JFR','RUNNABLE or a recurring stack is not measured CPU usage.'],
            ]},
        ],
        versions: [{type:'callout',title:'Command, fields and parser coverage are different',text:'The selected-version capability table and section B use the same release metadata as the upgrade comparison. The capture counts in section C describe tested builds/scenarios only. A filename ending in .txt does not identify classical versus file-dump plain text.'}],
        check: [
            {type:'list',items:[
                'Choose the target process explicitly. Use its JDK tools on the same host, with the required access. Record vendor/build, host/process context and the collection command.',
                'Ask that process for command help before collecting. Keep the jcmd PID prefix with classical output; it helps reject incompatible snapshots.',
                'Collect several snapshots while the symptom occurs. Keep input order and timestamps. In TDA, Add to session accepts separate files and pasted dumps.',
            ]},
            {type:'code',caption:'Inspection and capture recipe · HotSpot JDK 25 · replace PID and use a fresh output path',text:'jcmd PID VM.version\njcmd PID help Thread.print\njcmd PID Thread.print -l -e > thread-01.txt\njcmd PID help Thread.dump_to_file\njcmd PID Thread.dump_to_file -format=json thread-01.json',sources:['https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html']},
            {type:'callout',title:'Where the output goes',text:'Thread.print is redirected by your local shell. Thread.dump_to_file writes the path from the target JVM; choose a path that process can write. Collection has runtime impact. Do not add -overwrite to a recipe unless replacing an existing capture is intended.'},
            {type:'code',caption:'Illustrative classical header · not a full runnable fixture or real workload measurement',text:'1234:\n2026-10-06 10:00:00\n"worker" #31 prio=5 os_prio=0 cpu=100.00ms elapsed=10.00s tid=0x101 nid=0x202 runnable\n   java.lang.Thread.State: RUNNABLE'},
            {type:'list',items:[
                '1234 is the local target PID, not a global identity across machines, namespaces or restarts.',
                'cpu=100.00ms is cumulative thread CPU, not 100 ms during this request. A rate needs a comparable next observation and a usable interval.',
                'RUNNABLE includes some native/I/O activity. The raw stack and a CPU profile are needed to distinguish waiting from computation.',
            ]},
        ],
        measure: [
            {type:'list',items:[
                'Load a named CPU-sequence or virtual-thread example in TDA to inspect the difference between counter evidence and file-dump stacks.',
                'Before drawing a lock conclusion, inspect the owner/waiter raw evidence in the same snapshot. An absent thread in a partial capture is not a resolved incident.',
                'If counters are absent, collect the appropriate profile rather than treating missing values as zero. Use thread-dump evidence to choose the next check, not to claim application progress or business impact.',
            ]},
        ],
    },
    'object-headers': {
        does: [
            {type:'table',caption:'Three mechanisms, three different questions',headers:['Mechanism','Changes','Does not establish'],rows:[
                ['Compact Object Headers','The object header representation','That every aligned object shrinks or the application becomes faster.'],
                ['Compressed oops','References to heap objects','That the header itself is compact. Heap size/alignment/build affect reference encoding.'],
                ['Compressed class pointers','References to class metadata in object headers','That UseCompressedClassPointers remains a selectable mode on HotSpot 27.'],
            ]},
            {type:'table',caption:'Illustrative size calculation · 64-bit HotSpot, compressed references/class pointers, 8-byte object alignment',headers:['Example payload','12-byte conventional header','8-byte compact header','Interpretation'],rows:[
                ['One 4-byte field','roundUp(12 + 4, 8) = 16 B','roundUp(8 + 4, 8) = 16 B','Same aligned size despite a smaller header.'],
                ['Two 4-byte fields','roundUp(12 + 8, 8) = 24 B','roundUp(8 + 8, 8) = 16 B','A possible 8 B difference for this illustrative layout.'],
            ],sources:['https://openjdk.org/jeps/450']},
            {type:'callout',title:'A calculation is not a heap measurement',text:'These arithmetic examples omit VM-specific field placement, inheritance, arrays, padding and special layouts. They are not captured JOL output. Inspect actual classes on the exact build and count the live objects before estimating application savings.'},
        ],
        versions: [
            {type:'callout',title:'The class-pointer flag has its own lifecycle',text:'HotSpot deprecated UseCompressedClassPointers in 25, and made it obsolete in 27. In 27 the option is ignored with a warning and class pointers are always compressed. This is separate from UseCompressedOops. Read the selected-version table before reusing an old launch command.',sources:['https://www.oracle.com/java/technologies/javase/25-relnote-issues.html','https://www.oracle.com/java/technologies/javase/27-relnote-issues.html']},
        ],
        check: [
            {type:'code',caption:'Read the running target configuration · HotSpot JDK 25 inspection recipe',text:'jcmd PID VM.version\njcmd PID VM.command_line\njcmd PID VM.flags -all',sources:['https://docs.oracle.com/en/java/javase/25/docs/specs/man/jcmd.html']},
            {type:'list',items:[
                'Record the actual vendor/build, architecture, collector, heap settings and ObjectAlignmentInBytes. A newly started java -version process is not proof of the running target configuration.',
                'In flag output, inspect UseCompactObjectHeaders and UseCompressedOops when present. Read the release-specific class-pointer guidance above; absence of an obsolete option is not an instruction to add it.',
                'Use a heap histogram/dump or object-layout tool appropriate to that build to identify dominant live classes. Heap collection can be expensive and can expose private data.',
            ]},
            {type:'code',caption:'Illustrative flag values · not measured output or a universal JDK default',text:'ObjectAlignmentInBytes = 8\nUseCompactObjectHeaders = false\nUseCompressedOops = true'},
            {type:'paragraph',text:'Interpretation: a supported VM with compact headers off may be a candidate for a controlled layout experiment. This output alone does not show enough live objects to justify changing anything. If the dominant classes keep the same aligned size, or heap footprint is not a constraint, leave the configuration unchanged.'},
        ],
        measure: [
            {type:'list',items:[
                'Define the problem and acceptance criteria first: live-set/RSS budget, latency, throughput and GC CPU. Use the same build, hardware, collector, heap and representative workload in each comparison.',
                'Measure actual aligned sizes and live counts for the important classes. Check total process memory as well as the heap; native memory does not automatically shrink with object headers.',
                'Run one supported configuration change in a separate test deployment. Experimental unlocking applies to the experimental JDK 24 feature; it is not a generic flag recipe for 25–27.',
                'Repeat the workload and check regressions as well as savings. Keep the previous launch configuration as the rollback. In JDK 27, compact headers are already on by upstream default; an experiment may instead test whether that new default caused a regression.',
            ]},
            {type:'callout',title:'What JvmScope can establish',text:'TDA can inspect thread and lock observations. TLS can inspect handshake observations. Neither measures aligned object size or the heap benefit of this optimization; their capture counts cannot validate it.'},
        ],
    },
};
