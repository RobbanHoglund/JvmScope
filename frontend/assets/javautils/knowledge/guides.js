// Teaching blocks contain text, never author-supplied HTML. Layout calculations
// are illustrative; the renderer labels them separately from real capture data.
export const GUIDES = {
    'gc-memory': {
        does: [
            {type:'table',caption:'Read the three GC timeline tracks independently',headers:['Track','Evidence','Do not infer'],rows:[
                ['Heap','Used bytes before/after a collection; capacity only when explicitly recorded','Total process RSS, Xmx, allocation rate or a leak. Young collections do not measure the complete live set.'],
                ['Stop-the-world pauses','Completed pause elapsed times, max, nearest-rank p95 and union of timed pause intervals','GC CPU time, all safepoints or request latency. Concurrent phases are not added to pauses.'],
                ['Concurrent / stalls','Concurrent phase and cycle elapsed times; individual allocation stalls','That all application threads stopped for a concurrent cycle or a single-thread allocation stall.'],
            ]},
            {type:'callout',title:'Annotations are evidence, not a diagnosis',text:'A pause above your selected budget is a configurable review threshold, not a Java rule. Full GC and high post-collection occupancy require context. Ordinary Allocation Failure is a collection trigger, not an OutOfMemoryError. Explicit System.gc requests are informational unless another independent rule fires.'},
            {type:'table',caption:'What triggers a JvmScope marker',headers:['Marker','Exact condition','Interpretation'],rows:[
                ['Pause budget · review','Completed pause strictly greater than the selected budget; initially 200 ms','Changing this value only reclassifies this capture. It does not set MaxGCPauseMillis or change the running JVM. A collector pause target is not a hard latency guarantee.'],
                ['Heap occupancy · review','After-collection used bytes at least 90% of explicitly recorded capacity','Capacity can differ from Xmx. A young collection is not a complete live-set measurement; this is not a leak detector.'],
                ['Full / degenerated collection · review','A parsed full or degenerated event','Inspect cause and frequency. A recorded explicit full collection is informational; independent budget or occupancy rules may still fire.'],
                ['Collector pressure · review','Recognized evacuation, to-space, promotion, concurrent-mode failure or degenerated-GC record','A logged symptom needs collector-specific investigation; the marker does not identify the root cause.'],
                ['Allocation stall / OOME · critical','A recognized Allocation Stall or OutOfMemoryError record','Critical is JvmScope severity, not a Java specification category. A stall can affect one allocating thread; an OOME message alone does not identify which memory area failed or prove process termination.'],
            ]},
            {type:'callout',title:'System.gc() is a request',text:'The API does not guarantee that a collection occurs or that memory is reclaimed. Collector configuration can ignore an explicit request or handle it concurrently. JvmScope reports an explicit full collection only when the parsed log records one.',sources:['https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/System.html#gc()']},
        ],
        versions: [
            {type:'paragraph',text:'The article includes general Java 7 context, but GC-log import starts at Java 8. The analyzer reads Oracle/OpenJDK HotSpot legacy Java 8 logs and unified logging from Java 9–27. Collector availability and record details vary by release and vendor. Serial, Parallel, G1, historical CMS, ZGC and Shenandoah captures are replayed in regression tests. This does not promise support for OpenJ9, every vendor extension, rotation gaps or every logging decoration.'},
            {type:'callout',title:'Log format is not a Java language specification',text:'Unified GC logging was introduced in JDK 9 (JEP 271). The parser uses recorded evidence and warns about incomplete records; it does not guess a Java version from a collector name. Keep the exact runtime build and capture flags with the log.',sources:['https://openjdk.org/jeps/271']},
        ],
        check: [
            {type:'code',caption:'HotSpot Java 8 startup recipe · choose a fresh writable output path',text:'java -XX:+PrintGCDetails -XX:+PrintGCDateStamps -XX:+PrintGCTimeStamps -Xloggc:gc.log -jar application.jar',sources:['https://docs.oracle.com/javase/8/docs/technotes/guides/vm/gctuning/']},
            {type:'code',caption:'HotSpot Java 9–27 startup recipe · verify flags on your exact target build',text:'java "-Xlog:gc*,safepoint:file=gc.log:time,uptime,level,tags:filecount=5,filesize=10M" -jar application.jar',sources:['https://openjdk.org/jeps/271']},
            {type:'callout',title:'Capture rotation and safepoints',text:'The quoted Java 9+ option is one shell argument, including its wildcard. It rotates files at approximately 10 MiB with up to five archived files plus the active file. Preserve the required interval and order it chronologically before import; numeric suffixes alone are not chronological order. JvmScope imports one UTF-8 file up to 64 MiB and does not assemble rotated files or decompress gzip. Safepoint logging is useful supplementary evidence, but the GC chart does not calculate all safepoint pauses or time to reach a safepoint.',sources:['https://docs.oracle.com/en/java/javase/25/docs/specs/man/java.html#enable-logging-with-the-jvm-unified-logging-framework']},
            {type:'list',items:['Do not change the collector just to collect a log. Record VM version, heap flags, workload interval and latency objectives separately. Logging has overhead and disk-space costs.','Load one chronological capture from one JVM. If you concatenate captures from different processes, explicit startup or clock-reset evidence is needed to separate them reliably. Rotation gaps cannot be reconstructed.','Use a representative observation interval. Tiny synthetic samples exercise the parser, not production performance. Remove private information before sharing captures externally.']},
        ],
        measure: [
            {type:'list',items:['Inspect the marked region, select its event and read the original lines before changing a flag. Red allocation-stall signals describe affected allocating threads, not a global stop.','Maximum and p95 use completed pause durations, including untimed events. P95 is the nearest-rank observation at ceil(0.95 × count), not an interpolated value. Time-based pause share excludes events without timestamps; inspect coverage warnings before comparing metrics.',
                'Observed pause share uses the first-to-last timed event window and merges overlapping pause intervals. It is not whole-process uptime, application throughput, or GC CPU utilization.','The heap curve connects discrete samples for orientation; unobserved points are not measured. ZGC percentages do not establish an exact capacity.','Evacuation/to-space failures, promotion failures and concurrent-mode failures warrant investigation. Correlate with available heap, allocation, CPU and I/O evidence before assigning a cause.','The timeline shows at most three numbered event annotations in the current range. Nearby annotations share a time-anchored badge. Use With review markers for event findings and Interpretation & capture coverage for standalone JVM signals; the absence of a marker is not proof of health.',
                'Use the four bundled real samples to learn the view. The repository includes provenance and repeatable Java 8–27 workload captures, plus an independent MXBean count oracle for Serial and Parallel collections. Failed or unsupported capture runs are recorded separately and are not verified combinations.']},
            {type:'paragraph',text:'A high post-GC heap alone is not a memory leak. Compare complete collection cycles over time and use object/retention evidence when appropriate. Likewise, a full collection can be requested by an operator or diagnostic tool.',sources:['https://docs.oracle.com/en/java/javase/25/gctuning/garbage-first-garbage-collector-tuning.html']},
        ],
    },
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
