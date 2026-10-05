/** Controlled synthetic monitor observations; not a captured JVM sample. */
export function blockingDump(second, entries, pid = '1234') {
    return `${pid ? `${pid}:\n` : ''}2026-10-05T12:00:0${second}.000Z\nFull thread dump OpenJDK 64-Bit Server VM:\n\n${entries.map(e => `"${e.name || `worker-${e.id}`}" #${e.id} prio=5 cpu=${100 + second * 20}ms elapsed=${100 + second}.000s tid=0x${e.id} nid=0x${e.id} ${e.wait ? 'waiting for monitor entry' : 'runnable'} [0x9000]\n   java.lang.Thread.State: ${e.wait ? 'BLOCKED' : 'RUNNABLE'}\n    at example.Work.run(Work.java:10)\n${e.wait ? `    - waiting to lock <${e.wait}> (a example.Lock)\n` : ''}${(e.held || []).map(id => `    - locked <${id}> (a example.Lock)\n`).join('')}\n`).join('')}JNI global refs: 1\n`;
}
export const blockingSequence = [
    blockingDump(0, [{id:1,held:['0xa']},{id:2,held:['0xb'],wait:'0xa'},{id:3},{id:4}]),
    blockingDump(1, [{id:1,held:['0xc']},{id:2,held:['0xd'],wait:'0xc'},{id:3,wait:'0xd'},{id:4,wait:'0xc'}]),
    blockingDump(2, [{id:1},{id:2,held:['0xe']},{id:3,wait:'0xe'},{id:4}]),
];
