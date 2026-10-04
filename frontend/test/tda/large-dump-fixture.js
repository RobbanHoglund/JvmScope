// Synthetic, deliberately distinct stack shapes exercise the slow clustering path.
export function largeThreadDump(threadCount = 3000) {
    return [0, 1, 2].map(snapshot => {
        const header = `2026-10-02 12:00:${String(snapshot * 5).padStart(2, '0')}\nFull thread dump OpenJDK 64-Bit Server VM:\n\n`;
        return header + Array.from({ length: threadCount }, (_, index) =>
            `"ga-worker-${index}" #${index + 1} prio=5 os_prio=0 cpu=${100 + snapshot * 100}.00ms elapsed=${10 + snapshot * 5}.00s tid=0x${(index + 1).toString(16)} nid=0x${(index + 1).toString(16)} runnable [0x1000]\n`
            + '   java.lang.Thread.State: RUNNABLE\n'
            + `\tat example.Workload${index}.calculate(Workload${index}.java:42)\n`
            + `\tat example.Request${index}.handle(Request${index}.java:21)\n`
            + `\tat example.Pipeline${index}.run(Pipeline${index}.java:5)\n`,
        ).join('\n');
    }).join('\n\n');
}
