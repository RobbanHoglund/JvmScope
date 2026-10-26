// Test-only MCP Apps host. Serves public fixtures and proxies actual MCP calls.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

export async function startHost() {
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const plugin = path.join(repo, 'build/codex-marketplace/plugins/jvmscope');
    const temporary = await mkdtemp(path.join(tmpdir(), 'jvmscope UI '));
    const capture = path.join(temporary, 'deadlock.txt');
    const original = await readFile(path.join(plugin, 'samples/confirmed-deadlock.txt'), 'utf8');
    await writeFile(capture, original);
    const injection = path.join(temporary, 'untrusted.txt');
    await writeFile(injection, original.replaceAll('alpha', '<svg/onload=alert(1)>'));
    const longName = path.join(temporary, 'production-payments-service-capture-2026-10-23-region-eu-north-cluster-primary-thread-dump.txt');
    await writeFile(longName, original);
    const paged = path.join(temporary, 'three-snapshots.txt');
    await writeFile(paged, [original, original, original].join('\n'));
    // Synthetic stress case: the ninth participant is intentionally beyond the graph bound.
    const many = path.join(temporary, 'nine-participants.txt');
    const name = i => `worker-${i}-with-a-long-descriptive-thread-name`;
    const lock = i => `0x${(4096 + i).toString(16)}`;
    const threads = Array.from({ length: 9 }, (_, i) => `"${name(i)}" #${i + 1} prio=5 tid=0x${i + 1} nid=0x${i + 1} waiting for monitor entry
 java.lang.Thread.State: BLOCKED (on object monitor)
 at example.Worker.run(Worker.java:12)
 - waiting to lock <${lock(i)}> (a example.Lock)
 - locked <${lock((i + 8) % 9)}> (a example.Lock)
`).join('\n');
    const cycles = Array.from({ length: 9 }, (_, i) => `"${name(i)}":
 waiting to lock monitor 0x${i + 1} (object ${lock(i)}, a example.Lock),
 which is held by "${name((i + 1) % 9)}"`).join('\n\n');
    await writeFile(many, `Full thread dump OpenJDK 64-Bit Server VM:\n\n${threads}\nFound one Java-level deadlock:\n=============================\n${cycles}\n\nJava stack information for the threads listed above:\n`);
    const client = new Client({ name: 'jvmscope-ui-host-test', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(plugin, 'server/server.mjs')], cwd: temporary }));
    const rendered = {}, calls = [];
    for (const [name, paths, limit, language] of [
        ['deadlock', [capture]], ['long', [longName]], ['injection', [injection]],
        ['multi', [path.join(repo, 'extensions/codex/test/fixtures/multiple-deadlocks.txt')]],
        ['unmapped', [path.join(repo, 'frontend/test/tda/fixtures/unmapped-deadlock-participants.txt')]],
        ['series', [path.join(plugin, 'samples/repeated-contention.txt')], 1],
        ['paged', [paged], 2],
        ['many', [many]],
        ['real', [path.join(repo, 'testdata/thread-dumps/real-java-all-3-snapshots.txt')]],
        ['realSv', [path.join(repo, 'testdata/thread-dumps/real-java-all-3-snapshots.txt')], undefined, 'sv'],
    ]) {
        const result = await client.callTool({ name: 'analyze_thread_dumps', arguments: { paths, ...(limit ? { limit } : {}) } });
        if (result.isError) throw new Error(JSON.stringify(result));
        rendered[name] = await client.callTool({ name: 'render_thread_report', arguments: { reportId: result.structuredContent.reportId, ...(language ? { language } : {}) } });
    }
    rendered.comparison = await client.callTool({ name: 'render_thread_report', arguments: { reportId: rendered.real.structuredContent.reportId, view: 'comparison', offset: 0, limit: 4 } });
    rendered.focused = await client.callTool({ name: 'render_thread_report', arguments: { reportId: rendered.real.structuredContent.reportId,
        snapshotIndex: 2, sourceKey: rendered.real._meta.jvmscopeReport.snapshots.items[2].deadlocks.items[0].participants.items[0].id } });
    const focusKeys = rendered.real._meta.jvmscopeReport.snapshots.items[2].measurements.threads.items
        .filter(t => ['scenario-cpu-and-allocation-hot', 'scenario-livelock-2-agent-1', 'scenario-livelock-2-agent-2'].includes(t.name)).map(t => t.sourceKey);
    rendered.threads = await client.callTool({ name: 'render_thread_details', arguments: { reportId: rendered.real.structuredContent.reportId, snapshotIndex: 2, sourceKeys: focusKeys } });
    rendered.threadSv = await client.callTool({ name: 'render_thread_details', arguments: { reportId: rendered.real.structuredContent.reportId, snapshotIndex: 2, sourceKeys: focusKeys, language: 'sv' } });
    rendered.demo = await client.callTool({ name: 'show_thread_example', arguments: { language: 'sv' } });
    const uri = (await client.listTools()).tools.find(t => t.name === 'render_thread_report')._meta.ui.resourceUri;
    const html = (await client.readResource({ uri })).contents[0].text;
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        try {
            if (url.pathname === '/widget') {
                res.setHeader('Content-Type', 'text/html');
                res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'");
                res.end(html); return;
            }
            if (url.pathname === '/data') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(rendered[url.searchParams.get('case') || 'deadlock'])); return; }
            if (url.pathname === '/tool' && req.method === 'POST') {
                let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 20000) throw new Error('Oversized request'); }
                const call = JSON.parse(raw);
                if (!['read_capture_lines', 'read_thread_evidence', 'render_thread_report', 'render_thread_details', 'analyze_thread_dumps'].includes(call.name)) throw new Error('Unexpected test tool');
                calls.push(call); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(await client.callTool(call))); return;
            }
            res.setHeader('Content-Type', 'text/html');
            res.end(`<!doctype html><html><body style="margin:0;background:#101720"><iframe title="JvmScope" sandbox="allow-scripts" src="/widget" style="display:block;width:100%;height:1000px;border:0"></iframe><script>
                const frame=document.querySelector('iframe'), query=new URLSearchParams(location.search); window.events=[];
                const send=m=>frame.contentWindow.postMessage({jsonrpc:'2.0',...m},'*');
                window.sendHostContext=context=>send({method:'ui/notifications/host-context-changed',params:context});
                addEventListener('message',async e=>{
                    if(e.source!==frame.contentWindow || e.data?.jsonrpc!=='2.0')return;
                    const m=e.data;window.events.push(m.method);
                    if(m.method==='ui/initialize')send({id:m.id,result:{protocolVersion:'2026-01-26',hostInfo:{name:'JvmScope test host',version:'1'},hostCapabilities:query.has('noTools')?{}:{serverTools:{}},hostContext:{theme:query.get('theme')||'dark',locale:query.get('locale')||'en'}}});
                    else if(m.method==='ui/notifications/initialized'){const r=await fetch('/data?case='+(query.get('case')||'deadlock'));const result=await r.json();send({method:'ui/notifications/tool-input',params:{arguments:{reportId:result.structuredContent.reportId}}});send({method:'ui/notifications/tool-result',params:result});}
                    else if(m.method==='ui/notifications/size-changed')frame.style.height=m.params.height+'px';
                    else if(m.method==='tools/call'){try{const r=await fetch('/tool',{method:'POST',body:JSON.stringify(m.params)});send({id:m.id,result:await r.json()});}catch(error){send({id:m.id,error:{code:-32603,message:error.message}});}}
                });
            </script></body></html>`);
        } catch (error) { res.statusCode = 500; res.end(JSON.stringify({ error: error.message })); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return { url: `http://127.0.0.1:${server.address().port}`, calls, capture, original,
        async close() { await new Promise(resolve => server.close(resolve)); await client.close(); await rm(temporary, { recursive: true, force: true }); } };
}
