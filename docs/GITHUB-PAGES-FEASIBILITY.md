# Förstudie: JvmScope på GitHub Pages

Kontrolldatum: **2026-10-04**. Repository: [RobbanHoglund/JvmScope](https://github.com/RobbanHoglund/JvmScope).

## Slutsats

**JA, tekniskt kan hela den nuvarande applikationen köras på GitHub Pages utan Java- eller Railway-runtime.** Både Thread Dump Analyzer och TLS Log Analyzer analyserar användarens innehåll i webbläsaren. Den nödvändiga leveransen består av statiska filer.

**Nuvarande byggoutput kan däremot inte publiceras oförändrad på projektadressen `/JvmScope/`.** Startsidan saknas och navigationen använder absoluta `/jvmscope/`-länkar. En isolerad byggkopia med dessa två skillnader korrigerade klarade den lokala statiska verifieringen. Applikationskoden har inte ändrats.

**Användningsvillkor: VILLKORAT.** Ett kostnadsfritt projektverktyg är en rimlig Pages-kandidat, förutsatt att kontoplan, publiceringsåtkomst och faktisk användning passar villkoren. För en kommersiell SaaS-tjänst rekommenderas **inte Pages**: GitHub begränsar sådan användning. Affärsmodellen är inte fastställd. [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

Rekommendationen är **alternativ A: hela appen som statiska filer**, med en separat Pages-byggning som bevarar dagens lokala Java-paketering. Behåll Railway tills en senare, uttryckligen beslutad publicering har verifierats på den verkliga adressen. Ingen besparing i kronor kan beräknas med det tillgängliga kostnadsunderlaget.

## Utgångsläge och avgränsning

- Granskad checkout: `C:\ws\git\JvmScope`, branch `main`.
- Commit: `e824da7a2066e1f97ff22633151c5753cc727fcb`.
- `git pull --ff-only`: lyckades, redan uppdaterat. Arbetskopian var ren vid start.
- Utvecklingsinstruktionerna i `docs/DEVELOPMENT.md` lästes. Ingen ytterligare lokal `AGENTS.md` hittades; användarens globala Git- och konsekvensregler tillämpades.
- Applikationskod, befintliga tester/workflows, GitHub-inställningar, reposynlighet och Railway har inte ändrats. Ingen commit, push eller PR har gjorts.
- Endast denna rapport tillkommer som repository-fil. Isolerade byggkopior, testharness, loggar och screenshots ligger i ignorerade `.run/pages-feasibility/`.
- Den befintliga appen på port 23873 lämnades igång. Dess Java-process var fortfarande densamma efter testerna och `/health` svarade 200. De egna statiska testservrarna och testwebbläsarna stängdes.

Studien verifierar statisk leverans av den aktuella appen. Den är inte en ny fullständig GA-, sekretess- eller Git-historikgranskning.

## Vad implementationen faktiskt gör

Kodreferenserna nedan gäller den granskade committen, inte en senare version av `main`.

| Del | Verifierad implementation | Kodreferens |
| --- | --- | --- |
| TDA: filer och session | `file.text()` läser lokala filer. Sessionens källor skickas till analysklienten; inklistring och flera källor bygger samma lokala session. | [tda.js:4254](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/frontend/assets/javautils/tda.js#L4254), även 4106, 4210 och 4485 |
| TDA: parsning/diagnostik | En module Worker kör `analyzeThreadDumpData` från `tda/analysis.js`. `postMessage` är kommunikation inom webbläsaren, inte ett HTTP-anrop. | [analysis-client.js:2](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/frontend/assets/javautils/tda/analysis-client.js#L2), [analysis-worker.js:1](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/frontend/assets/javautils/tda/analysis-worker.js#L1) |
| TLS: filer och analys | `file.text()` läser loggen. En module Worker kör `analyzeTlsLog` och förbereder analysmodellen lokalt. | [tls.js:953](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/frontend/assets/javautils/tls.js#L953), även 849 och 973; [tls-analysis-worker.js:1](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/frontend/assets/javautils/tls-analysis-worker.js#L1) |
| Exempelbibliotek | En uttrycklig katalog väljer 15 TDA- och 20 TLS-filer. `fetchImpl(sample.url, {signal, credentials: 'omit'})` hämtar den valda filen, utan användarinnehåll. | [example-catalog.js:119](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/frontend/assets/javautils/example-catalog.js#L119) |
| Java-server | En enda HTTP-handler levererar paketerade filer, `/health` och omdirigeringar. Endast GET/HEAD tillåts; request bodies avvisas. Ingen analysfunktion exponeras. | [SlimServer.java:126](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/slim/src/main/java/com/robbanhoglund/jvmscope/server/SlimServer.java#L126), även 83 och 150 |
| Rådatavy | TDA skapar en ny flik med `window.open('', '_blank')` och fyller den lokalt. Stylesheet-adressen härleds från `import.meta.url`. Ingen separat servervy behövs. | [tda.js:3954](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/frontend/assets/javautils/tda.js#L3954), även 3975 |
| Export | Beroendegrafen serialiseras till SVG/Blob, ritas på Canvas och laddas ned som PNG. Råtext kopieras lokalt till urklipp. | [dependency-graph-view.js:2582](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/frontend/assets/javautils/tda/dependency-graph-view.js#L2582), även 2631; `tda.js:4090`, `tls.js:749` |
| Storage | Endast rådatavyns visningspreferenser lagras i `localStorage`, nyckel `tda.rawDumpWorkspace.v1`. Dumptext lagras inte där. | [raw-dump-view.js:9](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/frontend/assets/javautils/tda/raw-dump-view.js#L9), även 37, 45 och 75 |

Sökning i hela `frontend/assets/` och granskning av servern gav inget upload-/analys-API, WebSocket, EventSource, databas, autentisering, servergenererad frontendkonfiguration eller telemetri. Inga service workers, `SharedArrayBuffer` eller krav på `crossOriginIsolated` hittades. `HOST`/`PORT` konfigurerar endast Java-serverns lyssningsadress.

Webbläsaren hämtar HTML, JS, CSS, ikoner, D3 och workers från samma webbplats. Valda exempel ger ytterligare GET-anrop. Hjälpens kompatibilitetslänk öppnar GitHub först när användaren följer den. Typsnitten är system-/lokala fontfamiljer; inga externa font- eller CDN-hämtningar behövs. Vid vanlig inläsning hämtas programfiler, medan **användarens fil läses via File API och analyseras i worker-minnet**.

Det finns ingen nödvändig analysbackend att behålla. Serverns övriga egenskaper är transport, headers, cache, omdirigeringar och övervakning. Dessa måste bedömas vid byte av värd, men kräver inte Java för att utföra analysen.

## Byggning jämfört med användning

[Vite-konfigurationen:45](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/frontend/vite.config.js#L45) skiljer frontend-preview från applikationsbygget. Läget `slim` väljer endast TDA/TLS; normal preview inkluderar även portalens HTML. Applikationens befintliga statiska output är exakt **`slim/build/frontend/`**, före Gradles inpaketering.

```text
slim/build/frontend/
  jvmscope/tda.html
  jvmscope/tls.html
  assets/js/...
  assets/css/...
  assets/examples/...
  assets/legal/...
  assets/...
```

Publicera innehållet i en motsvarande separat Pages-katalog, med en ingångssida tillagd. Publicera **inte** repository-roten, `frontend/` som källträd, `docs/`, `testdata/`, `node_modules/` eller `slim/build/package/`. Paketkatalogen innehåller JAR och Java-runtime, vilka inte ska laddas till Pages.

| Behov | Statisk Pages-byggning/test | Besökarens användning | Befintlig lokal leverans |
| --- | --- | --- | --- |
| Node/npm/Vite | Ja, byggverktyg; Node 24 är testad baslinje | Nej | Frontend byggs med samma verktyg |
| Chromium/Playwright | För browserverifiering | Nej, besökaren har egen modern webbläsare | Används också för pakettester |
| JDK 25/Gradle/jlink | Inte för frontend-bygget eller denna statiska verifiering | Nej | Behövs för Java-paketet och dess HTTP-tester |
| Docker/Java-process | Nej | Nej | Valfri container eller lokalt statiskt serverpaket |
| Railway | Nej för analysen | Nej vid framtida Pages-leverans | Kan bevaras tills driftbytet godkänts |

[slim/build.gradle:31](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/slim/build.gradle#L31) kör frontendbygget; `prepareAssets` på rad 44 packar det därefter. `stageSlim` på rad 109 lägger till JAR/runtime. Root `Dockerfile` bygger samma frontend i Node-steget och paketerar Java i följande steg. `slim/railway.toml` använder Dockerfile, `/health` och omstart vid fel. Ingen av dessa paketeringsfunktioner gör användarens analys serverbaserad.

## Lokal teknisk verifiering

### Metod och kommandon

Miljö: Windows, Node **24.15.0**, npm **11.5.1**, installerad Vite **8.2.2**, Playwright **1.63.0**, Chromium. Befintliga installerade beroenden användes; ingen `npm ci`, JAR-ombyggnad eller launcher kördes mot den igångvarande appen.

Från repository-roten:

```powershell
npm test --prefix frontend
```

Från `frontend/`, samma slim-byggning som applikationen men med separat output och projektprefix:

```powershell
npx --no-install vite build --mode slim --base /JvmScope/ --outDir ../.run/pages-feasibility/project-build
```

Därefter från repository-roten:

```powershell
node .run/pages-feasibility/probe.mjs
node .run/pages-feasibility/prepare.mjs
node .run/pages-feasibility/audit.mjs
```

Från `frontend/`, det fokuserade browserurvalet:

```powershell
npx --no-install playwright test --config ../.run/pages-feasibility/config.mjs --grep 'Pages|guide|loads every named example|real CPU example|real virtual workers|files, Paste|raw evidence opens|raw-tab details|thread details keep|actual Java 27|events jump|linked investigation|real mutual TLS'
```

Harnessen ligger endast i `.run/pages-feasibility/`. Den använder en enkel Node HTTP-filserver på en automatiskt vald loopbackport. Den monterar filerna **enbart under exakt `/JvmScope/`**, kontrollerar skiftläge även på Windows och levererar rätt MIME. Den har ingen Vite-middleware, proxy, Java-backend, API, SPA-fallback, omskrivning eller serveromdirigering. Varje server stängs i `finally`.

Först testades den orörda byggoutputen. Därefter kopierades den till `candidate/`, där **endast de två emitterade HTML-filernas navigationslänkar** ändrades från `/jvmscope/` till `/JvmScope/jvmscope/`. En enkel tillfällig `index.html` med två relativa verktygslänkar lades till. Ändringarna avser testartefakten, inte källkoden eller en färdig produktstartsida.

Sex befintliga specfiler kopierades till harnessen: `help-search`, `example-library`, `tda-session`, `tda-raw-tab`, `tda-thread-details` och `tls-investigation`. Importer och serverfixture anpassades till de temporära kopiorna. Källfixture-adresser behölls så att hämtade exempel jämfördes mot originalbytes. Tre ytterligare tester kontrollerade projektroot/navigation, innehållssekretess och PNG-export.

### Resultat

| Kontroll | Resultat |
| --- | --- |
| Orörd output under projektprefix | Båda direktlänkarna svarade 200 och analyserade quick samples: TLS 35 interaktioner, TDA 67 trådar. **`/JvmScope/` och båda navigationslänkarna svarade 404.** |
| Node-tester | **646 passerade, 0 fel**: TDA unit 355/integration 27, TLS unit 142/integration 92, launcher 12, JVM-sample-verktyg 18. |
| Kompatibilitetsunderlag | **441 befintliga runtime-rapporter återspelades**; genererad dokumentation matchade. Nya JVM-captures genererades inte. |
| Browsertester på korrigerad testkopia | **42/42 passerade**, 21 scenarier vardera i desktop 1440×900 och laptop 1366×768; inga retries. Sista körningen tog cirka 1,5 minuter. |
| Startsida, navigation, reload | Båda länkarna, byte mellan verktygen och omladdning på undersidor fungerade. Omladdning tömmer minnessessionen, som idag. |
| Moduler/workers/assets | Båda module workers och D3 fungerade. Testet hade inga COOP/COEP-headers; `crossOriginIsolated` var false. Alla **51 filer** gav 200 på GET och HEAD, korrekt MIME och identiska GET-bytes; HEAD saknade kropp. |
| Hjälp/exempel | Båda guidernas sökning, återställning och innehåll på kort desktop testades. Samtliga **15 TDA + 20 TLS**-exempel hämtades och analyserades i båda viewportarna. |
| TDA-inmatning | Lokala filer, flera filer, Paste, Ctrl+V och drop byggde en sjusnapshot-session med tidslinje och historik. CPU-hot-följd, virtuella trådar och Java 27 JSON-detaljer testades också. |
| TLS-inmatning/vyer | Lokala loggfiler och exempel analyserades; investigationspanel, periodfilter, källrader, certifikat och råtextkopiering testades. TLS har idag ingen motsvarande Paste-knapp; en sådan funktion infördes inte. |
| Rådata och graf | TDA:s separata rådataflik, exakt text, sökning, filter, kopiering, detaljer samt återlänkar till tråd-/låsgraf fungerade. TLS behöll råtext genom periodfiltrering. |
| Export | TDA:s graf laddades ned som PNG, med validerad PNG-signatur. Exportfilerna var 395 518 respektive 376 692 bytes. Ingen exportbackend användes. |
| Nätverk/konsol | Sista körningen registrerade **728 filanrop**, samtliga GET/200 och utan kropp. Inga oplanerade externa anrop, JavaScript-fel eller console errors accepterades av fixture-kontrollerna. |
| Innehållssekretess | Syntetiska dump-/loggtexter och filnamn med `PRIVATE_CONTENT_SENTINEL_TDA/TLS` öppnades, analyserades och visades. Markörerna saknades i observerade anrops URL:er, headers och kroppar samt i localStorage. |
| Negativa routes | Åtta felaktiga/utgångna paths gav 404, inklusive fel skiftläge, saknad sida, `/health`, `/JvmScope/health` och `/javautils/tda.html`. Ingen fallback dolde fel. |

**Testfynd som inte ska döljas:** Den första browserkörningen gav 38 pass/4 fail. Två fel kom från ett felaktigt länknamn i den nya tillfälliga harnessen. Två kom från den befintliga testväljaren på [tda-raw-tab.spec.js:95](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/frontend/test/tls/browser/tda-raw-tab.spec.js#L95): `Inspect 0x000000aa` matchade tre giltiga knappar. Endast testkopians väljare begränsades till `.raw-workspace-inspector`. Därefter passerade hela urvalet. Detta visar en testambiguitet som bör rättas separat; det bevisar inte att hela det oförändrade GA-browserpaketet är grönt.

Bevisfiler: `.run/pages-feasibility/unit.log`, `build.log`, `baseline.json`, `browser-first.log`, `browser.log`, `network-static-desktop.json`, `network-static-laptop.json`, `artifact-audit.json`, `copied-test-artifacts/` och `results/`. Screenshots av TLS-vyn och TDA-grafen inspekterades också visuellt.

### Vad som inte verifierats

Ingen verklig Pages-deployment genomfördes. GitHubs CDN-cache, faktiska headers, externa HTTPS-origin, kontoplan, Pages-behörigheter och verkliga publika trafik har därför inte testats. Chromium testades; Firefox/Safari och manuella clipboard-/popup-behörighetsdialoger ingick inte. Loopback räknas som säker browserkontext, och testet gav clipboard-behörighet; detta ersätter inte kontroll på den framtida HTTPS-adressen.

Detta var ett fokuserat hostingurval, inte samtliga browserregressioner eller nya stora fil-/lasttester. Java-server- och containerintegrationerna kördes inte om, eftersom frontendstudien inte ändrar dem och inte ska bygga om användarens aktiva runtime. Ingen offline/PWA-funktion påstås: första leverans och exempelhämtningar kräver nätverk.

## Pages-specifika hinder och konsekvenser

### Paths, root och omdirigeringar

`/jvmscope/` är appens interna HTML-katalog. `/JvmScope/` är projektets publiceringsprefix. De behöver inte slås ihop eller byta namn; rätt direktadress blir **`/JvmScope/jvmscope/tda.html`**. Den lokala servern behandlade skiftlägen olika.

[vite.config.js:36](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/frontend/vite.config.js#L36) injicerar hårdkodade navigation-anchors. Vites `--base /JvmScope/` rättar byggda script-/CSS-/ikon-/workeradresser, men rättar inte dessa anchors. `base` är normalt `/` på rad 47. En separat Pages-mode ska använda rätt base och generera navigation utifrån den **slutligt upplösta Vite-konfigurationen**, inklusive CLI-override.

Slim-mode har två HTML-entrypoints på rad 76 och ingen root-index. Java-servern omdirigerar idag root till TLS; filservern kan inte ersätta det automatiskt. Lägg en statisk `index.html` överst i Pages-artefakten. GitHubs dokumentation anger en ingångsfil överst även vid Actions-publicering. [Creating a GitHub Pages site](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

Detta är en flerpages-app, inte en SPA som behöver en generell 404-fallback. Behåll riktiga 404-svar. Gamla Railway-länkar och root-adresserna `/javautils/*` följer inte med automatiskt till en ny origin. Eventuella redirect-stubs inom projektprefixet är ett senare kompatibilitetsval; en projektartefakt ska inte försöka ta över andra projekt på `robbanhoglund.github.io`.

### Headers, cache och övervakning

Java sätter `X-Content-Type-Options: nosniff` och `Referrer-Policy: strict-origin-when-cross-origin` på rad 128, samt egna ETag-, gzip- och cache-regler på rad 172. CSP, COOP och COEP sätts inte av denna server. Railway/andra mellanlager kan ha ytterligare headers som inte granskats här.

Pages bestämmer HTTP-leveransen. Ingen dokumenterad inställning för godtyckliga egna response headers hittades i de granskade Pages-workflow- eller [REST-inställningarna](https://docs.github.com/en/rest/pages/pages#update-information-about-a-github-pages-site). Detta är en slutsats från det dokumenterade gränssnittet, inte en mätning av den framtida sajten. Egna MIME-överstyrningar per fil/repo stöds inte enligt [Pages MIME-dokumentationen](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site#mime-types-on-github-pages).

Ingen aktuell analysfunktion behöver specialheaders: testet fungerade utan dem med vanliga `.js`/`.css`/`.json`/`.txt`-MIME. **Säkerhets- och cacheparitet är ändå inte bevisad.** Kontrollera faktiska Pages-svar innan driftbyte; behåll HTML-referrer-policy om det behövs. Om en framtida funktion kräver kontrollerbara CSP-/COOP-/COEP-headers eller egna API-svar bör en annan statisk värd övervägas.

Behåll fingerprintade assetnamn och publicera hela artefakten från samma commit. Testa att öppna en gammal flik och ladda om efter en ny release: CDN-cache och borttagna worker-/chunk-filer kan påverka en pågående session. Någon garanti för dagens `immutable`/ETag-policy ges inte. Ingen service worker behöver migreras eller rensas.

`/health`, processomstart, SIGTERM och Java-resursgränser försvinner ur det publika driftkontraktet. Ersätt eventuell extern övervakning med kontroll av båda statiska HTML-sidorna och en tillhörande JS-fil. Publicera inte en statisk `health.json` som felaktigt antyder att browseranalysen fungerar.

### Origin, lagring och integritet

En projektpath skapar inte en egen browser-origin. Andra sajter på `https://robbanhoglund.github.io` delar bland annat localStorage-utrymme och browserbehörigheternas origin. Den befintliga preferensnyckeln bör få JvmScope-prefix för att undvika kollisioner. Det skapar **inte** en säkerhetsgräns mot annat innehåll med samma origin. Publicera endast betrodda egna projekt på denna origin; välj en separat domän/origin om isolering behövs.

Appen lagrar inte användarens råinnehåll där, men innehållet finns i den aktiva sidans minne. Originens förtroende är därför fortfarande relevant. En flytt överför inte sessionsminne, visningspreferenser eller tidigare clipboard-/popup-behörigheter. Användaren får öppna filerna igen.

GitHub registrerar besökarens IP-adress av säkerhetsskäl. Att analysinnehåll stannar lokalt innebär alltså inte att inga besöksmetadata behandlas av hostingplattformen. [What is GitHub Pages? – Data collection](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection).

### Publiceringspaket och licenser

Den korrigerade testkatalogen innehöll **51 filer, 2 359 781 bytes (2,25 MiB)**, varav 35 exempel. Den orörda katalogen hade 50 filer; skillnaden är root-index. Största filen var TDA-bundlen, cirka 304 KB. Paketet innehöll inga JAR, Java-klasser, sourcemaps, shell-/PowerShell-skript, miljöfiler eller ZIP-arkiv, och inga symlänkar. Ingångsfil/notices i en senare produktleverans kan ändra storleken något.

Katalogens explicita exempelurval granskades tillsammans med `docs/EXAMPLES.md` och `testdata/README.md`. Sökning i emitterade filer efter privata PEM-nycklar, vanliga GitHub-/AWS-tokenmönster och lokala `C:\Users\`/`C:\ws\`-paths gav inga träffar. Kontrollerade JSSE-exempel kan innehålla **temporära testsessionshemligheter**, inte credentials till externa produktionssystem. Denna begränsade kontroll är inte en garanti för att varje möjlig hemlighet detekteras och inte en ny historikscan.

Behåll en publicerings-allowlist och en manifestkontroll i det framtida bygget. Att `.gitignore` skyddar privata captures räcker inte om ett framtida skript kopierar hela arbetskatalogen. Publicera endast de avsiktliga exempel som importeras av katalogen, aldrig övriga regressioner eller privata captures.

D3 och dess ISC-licens är frontend-runtime. `assets/legal/d3-LICENSE.txt` samt `Apache-2.0.txt` fanns och svarade 200; behåll dem. Root `THIRD-PARTY-NOTICES.md` följer inte med dagens statiska output och bör kopieras/länkas i Pages-paketet. Node/Vite/Playwright/Chromium och Java/OS-runtime ska inte följa med frontend-artefakten. Java-runtime-notices måste däremot fortsatt följa med lokala Java-paket. Se [Third-party notices](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/THIRD-PARTY-NOTICES.md).

[README:203](https://github.com/RobbanHoglund/JvmScope/blob/e824da7a2066e1f97ff22633151c5753cc727fcb/README.md#L203) anger att projektlicens och contribution-policy ännu väljs. Hosting av ägarens app och att ge andra generell redistributionsrätt är skilda beslut. Besluta licens inför en eventuell publik kodrelease; rapporten lägger inte till en licens eller ändrar reposynlighet.

## GitHubs aktuella villkor och kvoter

Officiella källor nedan lästes via nätet **2026-10-04**. Bedömningen av konto/affärsmodell är villkorad; användarens plan och repo-inställningar har inte inspekterats.

### Tillgång och publicitet

Pages levererar statisk HTML/CSS/JS; Actions får användas för att bygga resultatet. GitHub Free stödjer Pages från **publika** repos. Privat repo kräver en plan som stödjer det, exempelvis Pro för ett personligt konto eller Team/Enterprise för organisationer. [What is GitHub Pages?](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages).

**Privat kodrepo innebär inte privat webbplats.** En normal Pages-sajt är publikt åtkomlig även om källrepot är privat. [Pages HTTPS/visibility](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).

Privat publicering med access control är en separat Enterprise Cloud-organisationsfunktion för private/internal projektrepos. Den använder en annan subdomän och kan kräva en annan base path. Detta kan inte antas för den tänkta personliga adressen. [Changing Pages visibility](https://docs.github.com/en/enterprise-cloud@latest/pages/getting-started-with-github-pages/changing-the-visibility-of-your-github-pages-site).

| Förutsättning | Bedömning |
| --- | --- |
| Kostnadsfritt projektverktyg, offentlig app | Tekniskt lämpligt. Villkor behöver stämmas av mot faktiskt syfte och konto. |
| Privat kodrepo, offentlig app | Möjligt med rätt plan; ingen repo-öppning behöver antas eller utföras. |
| Krav på privat appåtkomst | Inte löst av ett privat personligt repo. Utred Enterprise-funktionen eller annan värd. |
| Kommersiell SaaS/primärt kommersiella transaktioner | Pages är inte det rekommenderade alternativet enligt begränsningarna. Annan statisk hosting kan fortfarande eliminera Java-runtime. |

GitHubs förbud gäller Pages som gratis värd för onlinebusiness/e-handel eller primärt kommersiella transaktioner/kommersiell SaaS. Att appen saknar backend ger inte undantag. Ett gratis verktyg kopplat till en verksamhet måste bedömas utifrån faktisk användning, inte bara avsaknad av betalningsknapp. [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

### Plattformskvoter

| Gräns | Aktuell dokumentation |
| --- | --- |
| Publicerad sajt | Högst 1 GB |
| Källrepo | Rekommenderad gräns 1 GB |
| Trafik | Mjuk gräns 100 GB/månad |
| Deployment | Timeout efter 10 minuter |
| Byggen | Mjuk gräns 10/timme; gäller inte egna Actions-bygg-/publiceringsworkflows |
| Rate limits | Kan ge HTTP 429 |

Källa: [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits). Det uppmätta paketet ligger långt under storleksgränsen. Trafikåtgång och faktisk användartillväxt är okända.

### Actions och kostnader

Standardrunners anges som gratis både för **publika repos** och **GitHub Pages** i den aktuella faktureringsdokumentationen. Det är därför fel att utan vidare kalla varje privat Pages-build debiterbar. Övrig privat CI, exempelvis JVM-matris och containerchecks, har planberoende kvoter; larger runners är alltid debiterbara. Artifact-/cachelagring och retention bedöms separat. [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions).

| Plan | Inkluderade minuter/månad för kvoterad användning | Artifact storage |
| --- | --- | --- |
| Free | 2 000 | 500 MB |
| Pro | 3 000 | 1 GB |
| Team | 3 000 | 2 GB |
| Enterprise Cloud | 50 000 | 50 GB |

Källa: samma [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions). Cache har separat inkluderad gräns 10 GB/repo. Kontrollera kontots plan, budgetar och hur Pages-workflowens jobb klassificeras före aktivering. Rapporten lovar inte att alla befintliga checks/artifacts eller en nödvändig planuppgradering blir gratis. Sajtleverans och övrig CI är olika kostnadsposter.

## Alternativen och besparingen

Arbetsinsatserna är grova utvecklingsbedömningar för nuvarande kod, inte utfästelser eller prisofferter. Kontoplan/beslut och publiceringsbehörigheter kan ge ytterligare väntetid.

| Alternativ | Funktion/ändringar | Risk och kvarvarande drift | Arbete/underhåll | Kostnad som kan försvinna |
| --- | --- | --- | --- | --- |
| **A. Hela appen på Pages** | TDA och TLS fungerar statiskt. Kräver base-aware navigation, root-index, separat bygg-/publiceringsflöde och prefixregressioner. | Pages-villkor, offentlig sajt, delad origin, andra headers/cache och ändrade bokmärken. Ingen appserver behövs. | Ungefär 1–2 arbetsdagar för implementation, permanenta tester och första verifierade publicering. Därefter Node/frontend och eventuell lokal Java-distribution att underhålla. | JvmScopes Railway-CPU/RAM/egress och annan tillhörande drift **om** tjänsten senare avvecklas. Planavgift/övriga tjänster kan bestå. |
| **B. Frontend på Pages, backend kvar** | Ingen nödvändig analysbackend finns idag. Att behålla Java endast för `/health` hjälper inte den statiska analysen. | Två deploymentmiljöer kvar; CORS/originkontrakt om framtida API införs. Samma Pages-villkor gäller frontend. | Mer driftkomplexitet än A utan funktionell vinst. Motiverat först vid ett faktiskt framtida backendbehov. | Möjligen minskad statisk egress; appserverns löpande resurskostnad blir kvar. Ingen grund för en beloppsuppskattning. |
| **C. Endast presentation/docs på Pages** | Appen fortsätter oförändrad på Railway. En separat docsbyggning behövs. | Låg app-risk men två adresser och fortsatt Java/containerdrift. | Några timmar till ungefär en dag för en enkel docsleverans; dubbla leveranser kvar. | Normalt ingen JvmScope-runtimebesparing. |

**A rekommenderas tekniskt.** B löser inget befintligt serverbehov. C är ett dokumentationsval som inte uppfyller målet att ersätta appdriften. Om affärsmodellen gör Pages otillåtet, välj en annan statisk värd i stället för att behålla Java enbart för filleverans.

För en faktisk kostnadsjämförelse behövs JvmScope-tjänstens CPU-/RAM-användning och debitering under en representativ månad, egress, eventuella miljöer/volymer, planavgift och credits. Lägre resursförbrukning kan frigöra credits utan att sänka slutfakturan. Jämför med eventuell GitHub-plan, separat CI/lagring och frivillig domänkostnad.

## Minsta rekommenderade ändring, inte genomförd

Ingen ramverksändring eller ombyggnad av analysmotorerna behövs.

| Fil | Föreslagen ändring |
| --- | --- |
| `frontend/vite.config.js` | Ny `pages`-mode med samma TDA/TLS-inputs som slim, separat `build/pages/` och navigation baserad på slutligt upplöst base. Bevara `/` och dagens två outputkataloger för befintliga lägen. |
| `frontend/package.json` | Nytt `build:pages`-kommando som kör befintliga tester och det separata Pages-byggskriptet. |
| **Ny** `scripts/build-pages.mjs` | Bygg med `/JvmScope/`, skapa en riktig JvmScope-root-index med verktygslänkar, kopiera third-party notices och verifiera artefaktmanifestet. Scripts ska ligga i `scripts/`. |
| **Ny** `.github/workflows/github-pages.yml` | Separata build/deploy-jobb. Manuell publicering först, ingen deploy från PR. Behåll befintliga release-/JVM-workflows. |
| `frontend/test/tls/browser/fixtures.js` och **ny** `frontend/test/tls/playwright.pages.config.js` | Ett läge för en strikt statisk filserver under projektprefixet, med prefix i `appUrl`; inget Vite-preview eller Java i detta läge. |
| **Ny** `frontend/test/tls/browser/pages-hosting.spec.js` | Permanenta tester för root, båda direktlänkarna, navigation/reload, workers, exempel och nätverk utan användarinnehåll. |
| `README.md`, `docs/DEVELOPMENT.md`, `slim/README.md` | Förklara Pages-adressen, separat publiceringsbyggning, lokal paketering, offentlig sajt och att användarens analysdata stannar i browsern. |

Två separata förbättringar bör tas med när permanent verifiering införs: avgränsa den tvetydiga väljaren i `frontend/test/tls/browser/tda-raw-tab.spec.js:95`, och ge visningsnyckeln i `frontend/assets/javautils/tda/raw-dump-view.js:9` ett JvmScope-prefix. Preferensbyte kräver ett medvetet val om återställning/migration; inget råinnehåll behöver migreras. Detta är inte förändringar som har gjorts i förstudien.

## Föreslagen publiceringsplan, inte genomförd

1. **Beslut:** Bekräfta kostnadsfritt projektverktyg kontra kommersiell tjänst, tillgänglig GitHub-plan, privat/publikt kodrepo och accepterad offentlig webbplats. Gör inget automatiskt visibility-byte.
2. Implementera endast den separata Pages-byggningen och prefixhanteringen ovan. Testa samtidigt att nuvarande slim-/preview-adresser och lokala launchers behåller beteendet.
3. Föreslaget framtida byggkommando från repository-roten:

   ```bash
   npm ci --prefix frontend
   npm run build:pages --prefix frontend
   ```

   **`build:pages` finns inte ännu.** Det ska använda Vite-mode `pages`, base `/JvmScope/`, output `build/pages/`. Denna katalog måste innehålla `index.html`, `jvmscope/tda.html`, `jvmscope/tls.html` och endast avsiktliga assets/notices.

4. Workflow: checkout, Node 24, `npm ci`, test/build, Chromium-prefixkontroller och manifestkontroll. Ingen Java eller Docker behövs i Pages-jobbet. Använd `configure-pages`, `upload-pages-artifact` med **enbart `build/pages/`**, och ett separat `deploy-pages`-jobb med `needs: build`, `pages: write`, `id-token: write` och environment `github-pages`. Begränsa checkout/build till `contents: read`; tillåt deployment endast från godkänd branch/manuell körning. Pin actions till granskade versioner/commit-SHA vid implementation. [Custom Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
5. I repository Settings → Pages välj **GitHub Actions** som källa först efter beslut. Kontrollera Actions-policy, miljöskydd, branchvillkor och HTTPS. Ladda upp byggartefakten, inte repo-roten eller docs som publiceringskälla. [Publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site), [HTTPS](https://docs.github.com/en/pages/getting-started-with-github-pages/securing-your-github-pages-site-with-https).
6. Tänkt första leverans:

   | Syfte | URL |
   | --- | --- |
   | Ingång | `https://robbanhoglund.github.io/JvmScope/` |
   | TDA | `https://robbanhoglund.github.io/JvmScope/jvmscope/tda.html` |
   | TLS | `https://robbanhoglund.github.io/JvmScope/jvmscope/tls.html` |
   | Exempel/legal/program | Under `https://robbanhoglund.github.io/JvmScope/assets/` |

7. Verifiera på **verklig Pages-HTTPS** innan några länkar/drift ändras: båda direktlänkarna och root, reload, worker-MIME, headers/cache, clipboard/popup med normala behörigheter, samtliga exempel, lokal fil/paste, rådata, export, nätverkssekretess och en andra release med en gammal flik öppen. Kontrollera externa övervaknings- och dokumentationslänkar. Ett grönt Actions-jobb eller lokal build räcker inte ensamt.

Dokumentationen kräver korrekt Pages-artefakt och deploymentsamband. Ingen Jekyll-byggning behövs för Vite-outputen; en eventuell `.nojekyll` kan genereras i publiceringspaketet. Inga av dessa inställningar/workflows har skapats eller aktiverats här.

## Lokal paketering, övergång och återgång

Behåll `slim/build.gradle`, Java-servern, root/slim Dockerfiles, `scripts/start.*`, `stop.*` och `scripts/package/` för lokal/portabel distribution. Separat Pages-mode får inte ändra globala URL:er i slim-bygget eller skriva till den aktiva Java-runtimekatalogen. Kör framtida server-/containerregressioner inför en sådan implementation; denna studie ändrar inte deras kontrakt.

Vid framtida övergång: spara den godkända Railway-committen/containerleveransen och Pages-artefaktens manifest. Publicera Pages parallellt, testa och byt användarlänkar efter beslut. Upplys om ny origin, att befintliga in-memory-sessioner inte flyttas, och att filer måste öppnas igen. Ingen databas eller analysdata behöver migreras. Gamla bokmärken måste hanteras separat; ett eget domän-/redirectbeslut kan krävas.

Avveckla Railway-tjänsten först efter verifiering och en beslutad återgångsperiod. Så länge den hålls igång består dess kostnad; en gammal redirect-server är också fortsatt drift. Kontrollera separat att inga andra Railway-tjänster använder JvmScopes service/URL/healthcheck. Koppla inte bort ett gemensamt projekt eller andra tjänster för att avveckla denna app.

Vid problem: återställ publicerade länkar till den sparade Railway-leveransen, eller återpublicera en tidigare fungerande Pages-artefakt byggd med samma prefix. En rollback påverkar nya sidladdningar, men räddar inte automatiskt en redan trasig browser-session; be användaren ladda om och öppna källorna igen. Behåll kända leveransversioner under övergången och undvik samtidiga deploys av äldre och nyare commits.

## Systemkonsekvens och separat andra granskning

Det ändrade framtida kontraktet är **var och hur appens statiska filer kan nås**, inte var analysen körs. Granskningen omfattade båda HTML-producerarna, navigationsplugin, script/CSS/D3- och workeradresser, katalogens exempelhämtning, raw-popupens stylesheet, clipboard/file/drop, storage, export, Java-redirects/headers/health, Gradle/containerns paketering och befintliga testfixtures.

En separat andra kontroll utmanade prefixantagandet med fel skiftläge, saknade/legacy-routes och frånvarande health; kontrollerade alla emitterade filbytes/MIME på GET/HEAD; granskade anropsinnehåll med syntetiska markörer; kontrollerade paketets filtyper och provenance; samt jämförde arbetskopian med ursprungsläget. Det kvarstår ingen nödvändig backendväg i det kontrollerade runtime-flödet.

Kvarstående risker är verklig CDN-/header-/permissionverifiering, delad origin, kontoplan/villkor, gamla adresser och framtida artefaktskontamination. Befintliga testambiguiteter, privat historik och äldre bokmärken repareras inte genom denna rapport. Produktionsdrift och data har inte ändrats. Nästa beslut är om dessa förutsättningar passar avsedd användning, innan separat implementation och senare publicering godkänns.
