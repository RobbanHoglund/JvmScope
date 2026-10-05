import { EXPORT_WARNING, reportHtml, reportMarkdown } from './findings-report.js';

function element(tag, text, parent) { const node = document.createElement(tag); if(text != null) node.textContent = text; parent.append(node); return node; }
function download(text, extension) {
    const url = URL.createObjectURL(new Blob([text], {type:extension==='html'?'text/html;charset=utf-8':'text/markdown;charset=utf-8'}));
    const a = document.createElement('a'); a.href=url; a.download=`jvmscope-findings.${extension}`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
/** In-memory report only; editing and exporting require explicit UI actions. */
export function createFindingsReportView(root) {
    root.hidden=true;
    const findings = [];
    let revision = 0, reviewed = null;
    const details=element('details',null,root); details.id='findingsReport';
    const summary=element('summary','Selected findings report · 0',details);
    element('p',EXPORT_WARNING,details);
    const list=element('div',null,details); list.id='reportFindings';
    const preview=element('button','Preview report',details); preview.className='btn btn-sm';
    const dialog=element('dialog',null,details); dialog.id='reportPreview';
    element('h2','Review before export',dialog); element('p',EXPORT_WARNING,dialog);
    const reviewStatus=element('p',null,dialog); reviewStatus.setAttribute('role','status'); reviewStatus.hidden=true;
    const frame=element('iframe',null,dialog); frame.setAttribute('sandbox',''); frame.title='Print-friendly report preview';
    const label=element('label',null,dialog), ack=element('input',null,label); ack.type='checkbox';
    label.append(' I reviewed the selection and sensitive content.');
    const canExport=()=>ack.checked && reviewed?.revision===revision && findings.length>0;
    const buttons=['md','html'].map(ext=>{const b=element('button',`Export ${ext==='md'?'Markdown':'HTML'}`,dialog);b.className='btn';b.disabled=true;b.addEventListener('click',()=>{if(canExport())download(reviewed[ext],ext);});return b;});
    ack.addEventListener('change',()=>buttons.forEach(b=>b.disabled=!canExport()));
    const close=element('button','Close preview',dialog);close.className='btn';close.addEventListener('click',()=>dialog.close());
    function capturePreview() {
        const selected=structuredClone(findings);
        reviewed={revision,html:reportHtml(selected),md:reportMarkdown(selected)};
        frame.srcdoc=reviewed.html;ack.checked=false;buttons.forEach(b=>b.disabled=true);
    }
    function invalidateReview() {
        revision++;reviewed=null;ack.checked=false;buttons.forEach(b=>b.disabled=true);
        if(dialog.open) {
            capturePreview();reviewStatus.textContent='The report changed. Review the updated selection and sensitive content before exporting.';reviewStatus.hidden=false;
        } else {
            frame.removeAttribute('srcdoc');reviewStatus.hidden=true;
        }
    }
    preview.addEventListener('click',()=>{capturePreview();reviewStatus.hidden=true;dialog.showModal();});
    function render() {
        invalidateReview();
        summary.textContent=`Selected findings report · ${findings.length}`; preview.disabled=!findings.length;list.replaceChildren();
        findings.forEach((f,i)=>{
            const card=element('article',null,list);element('h4',`${i+1}. ${f.title}`,card);element('p',`${f.scope} · dataset ${f.context.datasetRevision} · ${f.observations.map(o=>`#${o.snapshotIndex+1}`).join(', ')}`,card);
            const notesLabel=element('label','User notes ',card), notes=element('textarea',null,notesLabel);notes.value=f.notes;notes.setAttribute('aria-label',`Notes for finding ${i+1}`);
            notes.addEventListener('input',()=>{f.notes=notes.value;invalidateReview();});
            for(const [text,delta] of [['Move up',-1],['Move down',1],['Remove',0]]){
                const b=element('button',text,card);b.className='btn btn-sm';b.disabled=delta!==0 && (i+delta<0||i+delta>=findings.length);
                b.addEventListener('click',()=>{if(!delta)findings.splice(i,1);else [findings[i],findings[i+delta]]=[findings[i+delta],findings[i]];render();});
            }
        });
    }
    render();
    return { add(finding) {root.hidden=false;findings.push(structuredClone(finding));details.open=true;render();}, clear(){root.hidden=true;findings.length=0;dialog.close();render();} };
}
