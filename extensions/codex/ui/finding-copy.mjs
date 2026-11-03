// Presentation only: the shared analyzer remains the source of severity and evidence.
const entries = value => Array.isArray(value) ? value : value?.items || [];
const fact = (finding, label) => entries(finding.facts).find(f => f.label === label)?.value;
const count = (finding, label) => fact(finding, label) ?? 'okänt antal';
const mappingWarning = f => entries(f.facts).some(v => v.label === 'Participant mapping warning');
const swedish = {
    'confirmed-deadlock': {
        title: 'Bekräftad Java-deadlock',
        summary: f => `${fact(f, 'JVM-reported cycles') === 'Unavailable'
            ? 'Deadlock-markerade trådblock finns, men cykelrapport saknas.'
            : `${count(f, 'JVM-reported cycles')} JVM-rapporterade cykler med ${count(f, 'Reported participant entries')} rapporterade deltagarposter.`} ${count(f, 'Matched thread blocks')} trådblock matchade.${mappingWarning(f) ? ' Vissa deltagare kunde inte matchas entydigt; se originaldiagnostiken.' : ''}`,
        qualification: 'Direkt rapporterat i tråddumpen, inte härlett av analysverktyget.',
        recommendation: 'Granska kodvägarna som tar låsen och gör låsordningen konsekvent för alla deltagare.',
    },
    'class-initialization-stall': {
        title: 'Klassinitiering kan ha stannat',
        summary: f => `${count(f, 'Waiting threads')} trådar väntar på klassinitiering, samtidigt som den observerade initierande tråden själv väntar i denna snapshot.`,
        qualification: 'Väntan och relationerna är observerade av JVM. Ett möjligt stopp är en tolkning, inte en bekräftad hängning eller deadlock.',
        recommendation: 'Granska initieringsstacken och flytta blockerande startarbete, cirkulär klassladdning eller externa väntetider från statisk initiering.',
    },
    'likely-lock-bottleneck': {
        title: 'Möjlig flaskhals vid lås',
        summary: f => `${count(f, 'Candidate blockers')} observerade låsägare kan fördröja ${count(f, 'Dependent waiters')} väntande trådar. Beroendet är observerat; grundorsaken är fortfarande en tolkning.`,
        qualification: 'Relationen visar en möjlig flaskhals, men bevisar inte grundorsak, väntetid eller påverkan på applikationen.',
        recommendation: 'Granska låsägarnas stackar först. Korta kritiska sektioner eller dela upp hårt belastade lås där applikationens krav tillåter det.',
    },
    'observed-lock-contention': {
        title: 'Observerad låskonkurrens',
        summary: f => `${count(f, 'Waiting threads')} trådar väntar på att ta ${count(f, 'Distinct lock resources')} JVM-lås i denna snapshot.`,
        qualification: 'Visar den observerade väntan, inte dess varaktighet, grundorsak eller påverkan på applikationen.',
        recommendation: 'Granska låsägare och väntande stackar. Flera närliggande snapshots hjälper till att skilja kort väntan från återkommande låskonkurrens.',
    },
    'cpu-hot': {
        title: 'Uppmätt hög CPU-användning i applikationstrådar',
        summary: f => `${count(f, 'Measured hot threads')} applikationstrådar överskrider den inställda CPU-gränsen under ett validerat intervall mellan snapshots. Sluttillståndet säger bara vad tråden gjorde vid själva insamlingen.`,
        qualification: 'CPU-aktiviteten är uppmätt. Gränsen för hög aktivitet är en inställning i analysverktyget, inte en JVM-diagnos.',
        recommendation: 'Granska de mest CPU-aktiva stackarna och jämför flera närliggande intervall innan du optimerar återkommande kodvägar.',
    },
    'infra-hot': {
        title: 'Uppmätt hög CPU-användning i infrastrukturtrådar',
        summary: f => `${count(f, 'Measured hot threads')} selector- eller event-loop-trådar överskrider den inställda CPU-gränsen under ett validerat intervall mellan snapshots.`,
        qualification: 'CPU-aktiviteten är uppmätt. Trådens infrastrukturroll är en tolkning av stackmönstret.',
        recommendation: 'Granska stora callbacks, långa uppgiftsköer och upprepad I/O-hantering. Bekräfta med JFR.',
    },
    'allocation-hot': {
        title: 'Uppmätt hög allokeringstakt',
        summary: f => `${count(f, 'Measured hot allocators')} trådar allokerar många byte mellan snapshots. Detta mäter allokeringstakt, inte kvarhållen heap eller minnesläckage.`,
        qualification: 'Avrundade räknare använder konservativa undre gränser. Mätningen gäller heap-allokering, inte kvarhållet minne, off-heap eller bevis för läckage.',
        recommendation: 'Granska allokeringstunga stackar med JFR eller en allokeringsprofilerare. Kontrollera kvarhållet minne separat.',
    },
    'possible-livelock': {
        title: 'Möjlig livelock',
        summary: () => 'Uppmätt CPU-aktivitet förekommer tillsammans med retry-, spin-, CAS-, yield- eller korta park-anrop. En tråddump kan inte bevisa att nyttigt arbete har upphört.',
        qualification: 'Mönstret kan stämma med livelock, men bevisar inte att framsteg har upphört.',
        recommendation: 'Samla flera närliggande snapshots eller en kort JFR-inspelning och kontrollera om tillstånd ändras utan att arbete slutförs.',
    },
    'possible-starvation': {
        title: 'Möjlig trådsvält',
        summary: () => 'Samma entydigt identifierade låsägare har minst tre väntande trådar vid båda ändpunkterna av ett intervall. Det kan tyda på trådsvält, men bevisar inte oavbruten väntan eller uteblivna framsteg.',
        qualification: 'Upprepad låskonkurrens vid ändpunkterna bevisar inte oavbruten väntan, uteblivna framsteg eller svält i schemaläggning eller resurser.',
        recommendation: 'Jämför flera snapshots, granska trådpoolernas belastning och kontrollera att köat arbete slutförs innan du ändrar pooler eller lås.',
    },
};

export const localizedFindingIds = Object.freeze(Object.keys(swedish));
export function findingCopy(finding, language) {
    const localized = language === 'sv' && swedish[finding.id];
    if (!localized) return { title: finding.title, summary: finding.summary,
        qualification: finding.qualification || finding.evidence?.qualification,
        recommendation: finding.recommendation, original: language === 'sv' };
    return { ...localized, summary: localized.summary(finding), original: false };
}

// Short, explicit overview; full analyzer wording stays available in the disclosure.
export function findingOverview(finding, language) {
    const sv = language === 'sv';
    const definitions = {
        'cpu-hot': ['Measured hot threads', n => sv ? `${n} applikationstrådar över inställd CPU-gräns mellan snapshots.` : `${n} application threads above the configured CPU threshold between snapshots.`],
        'infra-hot': ['Measured hot threads', n => sv ? `${n} infrastrukturtrådar över inställd CPU-gräns mellan snapshots.` : `${n} infrastructure threads above the configured CPU threshold between snapshots.`],
        'allocation-hot': ['Measured hot allocators', n => sv ? `${n} trådar över inställd allokeringsgräns. Visar inte kvarhållen heap.` : `${n} threads above the configured allocation threshold. Does not measure retained heap.`],
        'class-initialization-stall': ['Waiting threads', n => sv ? `${n} trådar väntar på klassinitiering; även den initierande tråden väntar.` : `${n} threads await class initialization; the initializer is also waiting.`],
    };
    const definition = definitions[finding.id], value = definition && fact(finding, definition[0]);
    return value != null ? definition[1](value) : findingCopy(finding, language).summary;
}
