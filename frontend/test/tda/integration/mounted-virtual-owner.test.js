import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {analyzeThreadDumpData} from '../../../assets/javautils/tda/analysis.js';
import {buildThreadDependencyGraph} from '../../../assets/javautils/tda/dependency-graph.js';
import {buildRawDumpModel} from '../../../assets/javautils/tda/raw-dump-model.js';
import {createBlockingFinding,reportHtml,reportMarkdown} from '../../../assets/javautils/findings-report.js';
const fixture=name=>readFileSync(new URL(`../fixtures/ga-regressions/${name}`,import.meta.url),'utf8');

test('real mounted virtual monitor belongs to the virtual thread through analysis, graph, raw view and export',()=>{
    for(const format of ['classic.txt','json.json']){
        const result=analyzeThreadDumpData(fixture(`carrier-${format}`));
        const snapshot=result.parsedDumps[0];
        const carrier=snapshot.threads.find(t=>String(t.jvmId)==='27');
        const virtual=snapshot.threads.find(t=>String(t.jvmId)==='26');
        assert.deepEqual(carrier.heldLocks,[],'carrier does not own mounted virtual monitors');
        assert.ok(virtual?.isVirtualThread);
        assert.equal(virtual.heldLocks.length,1);
        assert.equal(virtual.carrierSourceKey,carrier.sourceKey);
        assert.equal(virtual.cpuMs,null,'carrier CPU is not virtual CPU');
        assert.equal(virtual.allocatedBytes,null);
        assert.equal(virtual.blockedWaiterCount,1);
        const graph=buildThreadDependencyGraph(snapshot.threads);
        assert.equal(graph.dependencyEdges[0].target,`thread:${virtual.sourceKey}`);
        assert.equal(graph.metrics.mountRelationCount,1);
        const raw=buildRawDumpModel(snapshot);
        assert.equal(raw.lockIndex.get(virtual.heldLocks[0].lockId.toLowerCase()).owners[0].sourceKey,virtual.sourceKey);
        assert.equal(raw.exactSourceText,snapshot.rawText);
        assert.equal(snapshot.rawText.split('\n').slice(virtual.rawStartLine-1,virtual.rawEndLine).join('\n'),virtual.rawBlock.join('\n'));
        const pattern=result.blockingPatterns.find(p=>p.title===`Dependencies on ${virtual.threadName}`);
        assert.ok(pattern);
        const finding=createBlockingFinding({pattern,snapshotIndex:0,context:{}});
        for(const exportText of [reportHtml([finding]),reportMarkdown([finding])]){
            assert.ok(exportText.includes('Virtual thread')||exportText.includes('audit-virtual-owner'));
            assert.doesNotMatch(exportText,/Dependencies on ForkJoinPool-1-worker-1/);
        }
    }
});
