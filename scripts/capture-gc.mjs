// Deliberately run ONLY isolated small child JVMs. Persistent logs are actual
// VM output; metadata records exact builds, commands and independent MXBeans.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const scratch = resolve(root, '.run/gc-runtimes');
const output = resolve(root, 'testdata/gc-logs');
mkdirSync(scratch, { recursive: true }); mkdirSync(output, { recursive: true });
const versions = (process.argv[2] || '8,11,17,21,25,26,27').split(',').map(Number);
if (versions.some(v => !Number.isInteger(v) || v < 8 || v > 27)) throw new Error('Choose Java majors 8–27');
const hash = data => createHash('sha256').update(data).digest('hex');
const curl = url => execFileSync('curl', ['-fsSL', '--retry', '2', '--max-time', '60', url], { encoding:'utf8', maxBuffer:8e6 });
const classes = join(scratch, 'classes'); mkdirSync(classes, { recursive:true });
let compiled = false;
const rawExamples=new Set(['java8-parallel.log','java27-g1.log','java27-zgc.log','java17-shenandoah.log']);
const collectors = [['serial','UseSerialGC'],['parallel','UseParallelGC'],['g1','UseG1GC'],['cms','UseConcMarkSweepGC'],['zgc','UseZGC'],['shenandoah','UseShenandoahGC']];
for (const major of versions) {
    const cache = join(scratch, String(major)); mkdirSync(cache, { recursive:true });
    const metadataPath = join(cache, 'download.json');
    let provenance;
    if (existsSync(metadataPath)) provenance = JSON.parse(readFileSync(metadataPath));
    else {
        const query = new URLSearchParams({distribution:'zulu',version:String(major),architecture:'x64',operating_system:'linux',archive_type:'tar.gz',package_type:compiled?'jre':'jdk',directly_downloadable:'true',latest:'available',release_status:'ga'});
        let packages = JSON.parse(curl('https://api.foojay.io/disco/v3.0/packages?' + query)).result;
        let pkg = packages.filter(p=>p.lib_c_type==='glibc'&&!p.javafx_bundled).at(-1);
        if (!pkg) {
            query.set('package_type','jdk');
            packages=JSON.parse(curl('https://api.foojay.io/disco/v3.0/packages?'+query)).result;
            pkg=packages.filter(p=>p.lib_c_type==='glibc'&&!p.javafx_bundled).at(-1);
        }
        if (!pkg) throw new Error('No GA HotSpot runtime found for Java '+major);
        const info = JSON.parse(curl(pkg.links.pkg_info_uri)).result[0];
        const archive = join(cache, 'runtime.tar.gz');
        execFileSync('curl',['-fsSL','--retry','2','--max-time','300','-o',archive,info.direct_download_uri],{stdio:'inherit'});
        const bytes = readFileSync(archive);
        if (info.checksum && createHash(info.checksum_type).update(bytes).digest('hex') !== info.checksum.toLowerCase()) throw new Error('Runtime checksum mismatch');
        execFileSync('tar',['--no-same-owner','-xzf',archive,'-C',cache],{stdio:'inherit'});
        provenance={packageId:pkg.id,javaVersion:pkg.java_version,url:info.direct_download_uri,sha256:hash(bytes),catalogChecksum:info.checksum||null,catalogChecksumType:info.checksum_type||null};
        writeFileSync(metadataPath,JSON.stringify(provenance,null,2)+'\n');
    }
    const home = readdirSync(cache,{withFileTypes:true}).find(entry=>entry.isDirectory()&&existsSync(join(cache,entry.name,'bin/java')));
    if (!home) throw new Error('Extracted runtime has no java executable');
    const java=join(cache,home.name,'bin/java');
    if (!compiled) {
        const compilerHome=[cache,...readdirSync(scratch,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name!=='classes').map(e=>join(scratch,e.name))]
            .flatMap(dir=>readdirSync(dir,{withFileTypes:true}).filter(e=>e.isDirectory()).map(e=>join(dir,e.name)))
            .find(dir=>existsSync(join(dir,'bin/javac')));
        if(!compilerHome)throw new Error('A cached JDK is needed to compile the Java 8 workload. Run version 8 first.');
        const compilerVersion=execFileSync(join(compilerHome,'bin/javac'),['-version'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
        execFileSync(join(compilerHome,'bin/javac'),[...(/1\.8/.test(compilerVersion)?['-source','8','-target','8']:['--release','8']),'-d',classes,join(root,'tools/gc-samples/GcWorkload.java')]);
        compiled=true;
    }
    const report={major,capturedAt:new Date().toISOString(),provenance,workloadSha256:hash(readFileSync(join(root,'tools/gc-samples/GcWorkload.java'))),cases:[]};
    for (const [collector,flag] of collectors) {
        if (collector==='cms'&&major>=14 || collector==='zgc'&&major<11 || collector==='shenandoah'&&major<11) continue;
        const filename=`java${major}-${collector}.log`, log=join(cache,filename), oracle=join(cache,collector+'-oracle.txt');
        const options=['-Xms32m','-Xmx32m',...(major===9||major===10?['-XX:ParallelGCThreads=2','-XX:ConcGCThreads=1']:['-XX:ActiveProcessorCount=2']),'-XX:+UnlockExperimentalVMOptions','-XX:+'+flag];
        // Early Java 8 builds may lack ActiveProcessorCount; the selected current
        // maintenance builds support it. Any rejection is recorded, not hidden.
        options.push(...(major===8?['-XX:+PrintGCDetails','-XX:+PrintGCDateStamps','-XX:+PrintGCTimeStamps','-Xloggc:'+log]:['-Xlog:gc*,safepoint:file='+log+':time,uptime,level,tags']));
        const args=[...options,'-cp',classes,'GcWorkload',oracle];
        try {
            execFileSync(java,args,{encoding:'utf8',timeout:45000,maxBuffer:8e6,stdio:['ignore','pipe','pipe']});
            const oracleText=readFileSync(oracle,'utf8');
            if(!oracleText.includes('pressureReached=true')) throw new Error('Workload did not reach memory pressure');
            const bytes=readFileSync(log),file=filename+(rawExamples.has(filename)?'':'.gz');
            writeFileSync(join(output,file),rawExamples.has(filename)?bytes:gzipSync(bytes));
            report.cases.push({collector,status:'captured',file,sha256:hash(bytes),command:args.map(a=>a.replaceAll(root,'<checkout>')),oracle:oracleText});
            console.log(`Captured Java ${major} ${collector}`);
        } catch(error) {
            report.cases.push({collector,status:'unavailable-or-failed',code:error.code||null,signal:error.signal||null,error:String(error.stderr||error.message).slice(0,2000)});
            console.log(`Java ${major} ${collector}: ${String(error.stderr||error.message).slice(0,150)}`);
        }
    }
    writeFileSync(join(output,`java${major}-provenance.json`),JSON.stringify(report,null,2)+'\n');
    if(!['serial','parallel','g1'].every(c=>report.cases.some(x=>x.collector===c&&x.status==='captured'))) throw new Error('Core collector captures are missing for Java '+major);
}
