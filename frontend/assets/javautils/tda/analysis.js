// DOM-free TDA analysis shared by the worker and focused regression tests.
import { buildBlockingPatterns } from './blocking-patterns.js';
import { analyzeThreadDump, extractNormalizedFrames, parseDeadlocks, parseThreadDump } from './parser.js';
import { annotateDeadlocks } from './deadlocks.js';
import { observedVirtualThreadIds } from './dump-to-file.js';
import { canCompareThreadCollections } from './snapshot-quality.js';
import { buildClusterTimeline, classifyClusterTrend } from './runnable-cluster-trend.js';
import { createClusterCandidateIndex } from './runnable-cluster-candidates.js';
import { annotateThreadChanges } from './changes.js';
import { analyzeClassInitialization } from './class-initialization.js';
import { createRunnableCpuThresholds, evaluateAllocationRate, evaluateMeasuredCpu, evaluateRunnableCpu, getRunnableCpuThresholdProfile, isPossibleLivelockCandidate, isPossibleStarvationCandidate } from './classification.js';
import { diagnosticEvidenceFor } from './diagnostics.js';
import { evaluateRuntimeStackPatterns, evaluateSelectorOrEventLoopPattern, evaluateSynchronizationPatterns, isGenericSelectorOrEventLoopThread } from './generic-classification.js';
import { correlateThreadsAcrossSnapshots } from './identity.js';
import { annotateLockPrecedence } from './lock-precedence.js';
import { annotateSeriesDiagnostics } from './series-diagnostics.js';
import { analyzeSnapshotProblems } from './smart-analysis.js';
import { annotateCpuRates } from './temporal.js';
import { annotateSnapshotTimes } from './time-quality.js';
import { parseThreadDumpSession } from './session.js';

function isGenericStackFrame(frame) {
    const s = String(frame || '');
    if (!s) return true;

    return (
        s.startsWith('java.lang.Thread.run') ||
        s.startsWith('java.lang.VirtualThread.run') ||
        s.startsWith('java.lang.VirtualThread$') ||
        s.startsWith('jdk.internal.reflect.') ||
        s.startsWith('sun.reflect.') ||
        s.startsWith('java.base@') ||
        s.startsWith('java.lang.Object.wait') ||
        s.startsWith('jdk.internal.misc.Unsafe.park') ||
        s.startsWith('sun.misc.Unsafe.park')
    );
}

function isJdkStackFrame(frame) {
    const s = String(frame || '');
    return (
        s.startsWith('java.') ||
        s.startsWith('javax.') ||
        s.startsWith('jdk.') ||
        s.startsWith('sun.') ||
        s.startsWith('com.sun.')
    );
}

function enrichThreadStackSimilarityFields(thread, dumpIndex) {
    const normalizedFrames = extractNormalizedFrames(thread);
    const meaningfulFrames = normalizedFrames.filter((f) => !isGenericStackFrame(f));
    const appFrames = meaningfulFrames.filter((f) => !isJdkStackFrame(f));

    thread.dumpIndex = dumpIndex;
    thread.normalizedFrames = normalizedFrames;
    thread.meaningfulFrames = meaningfulFrames;
    thread.appFrames = appFrames;

    thread.strictFingerprint = meaningfulFrames.slice(0, 8).join(' | ');
    thread.relaxedFingerprint = meaningfulFrames.slice(0, 5).join(' | ');
    thread.appFingerprint = appFrames.slice(0, 4).join(' | ');

    thread.clusterRepresentativeFrames =
        appFrames.length > 0 ? appFrames.slice(0, 5) : meaningfulFrames.slice(0, 5);
}

function commonPrefixScore(aFrames, bFrames, maxDepth = 6) {
    const a = Array.isArray(aFrames) ? aFrames.slice(0, maxDepth) : [];
    const b = Array.isArray(bFrames) ? bFrames.slice(0, maxDepth) : [];
    const denom = Math.max(a.length, b.length, 1);

    let common = 0;
    for (let i = 0;i < Math.min(a.length, b.length, maxDepth);i++) {
        if (a[i] !== b[i]) break;
        common += 1;
    }

    return common / denom;
}

function jaccardScore(aFrames, bFrames, maxDepth = 8) {
    const a = new Set((Array.isArray(aFrames) ? aFrames : []).slice(0, maxDepth));
    const b = new Set((Array.isArray(bFrames) ? bFrames : []).slice(0, maxDepth));

    if (a.size === 0 && b.size === 0) return 1;
    if (a.size === 0 || b.size === 0) return 0;

    let intersection = 0;
    for (const v of a) {
        if (b.has(v)) intersection += 1;
    }

    const union = new Set([...a, ...b]).size;
    return union === 0 ? 0 : intersection / union;
}

function commonSuffixScore(aFrames, bFrames, maxDepth = 12) {
    const a = (Array.isArray(aFrames) ? aFrames : []).slice(-maxDepth);
    const b = (Array.isArray(bFrames) ? bFrames : []).slice(-maxDepth);

    if (!a.length || !b.length) return 0;

    let common = 0;
    let ai = a.length - 1;
    let bi = b.length - 1;

    while (ai >= 0 && bi >= 0) {
        if (a[ai] !== b[bi]) break;
        common += 1;
        ai -= 1;
        bi -= 1;
    }

    return common / Math.max(a.length, b.length, 1);
}

function countSharedTailFrames(aFrames, bFrames, maxDepth = 12) {
    const a = (Array.isArray(aFrames) ? aFrames : []).slice(-maxDepth);
    const b = (Array.isArray(bFrames) ? bFrames : []).slice(-maxDepth);

    let common = 0;
    let ai = a.length - 1;
    let bi = b.length - 1;

    while (ai >= 0 && bi >= 0) {
        if (a[ai] !== b[bi]) break;
        common += 1;
        ai -= 1;
        bi -= 1;
    }

    return common;
}

function countSharedOrderedFrames(aFrames, bFrames, maxDepth = 12) {
    const a = (Array.isArray(aFrames) ? aFrames : []).slice(0, maxDepth);
    const b = (Array.isArray(bFrames) ? bFrames : []).slice(0, maxDepth);

    let bi = 0;
    let matches = 0;

    for (let ai = 0;ai < a.length;ai++) {
        while (bi < b.length && b[bi] !== a[ai]) {
            bi += 1;
        }
        if (bi < b.length) {
            matches += 1;
            bi += 1;
        }
    }

    return matches;
}

function countSharedFrames(aFrames, bFrames, maxDepth = 12) {
    const a = new Set((Array.isArray(aFrames) ? aFrames : []).slice(0, maxDepth));
    const b = new Set((Array.isArray(bFrames) ? bFrames : []).slice(0, maxDepth));

    let shared = 0;
    for (const frame of a) {
        if (b.has(frame)) shared += 1;
    }
    return shared;
}

function orderedSequenceScore(aFrames, bFrames, maxDepth = 12) {
    const sharedOrdered = countSharedOrderedFrames(aFrames, bFrames, maxDepth);
    const aLen = Math.min((aFrames || []).length, maxDepth);
    const bLen = Math.min((bFrames || []).length, maxDepth);
    return sharedOrdered / Math.max(aLen, bLen, 1);
}

function formatSimilaritySummary(method, metrics) {
    const sharedTailFrames = Number(metrics?.sharedTailFrames || 0);
    const sharedOrderedFrames = Number(metrics?.sharedOrderedFrames || 0);
    const sharedFrames = Number(metrics?.sharedFrames || 0);
    const contiguousRunLength = Number(metrics?.contiguousRunLength || 0);

    switch (method) {
        case 'normalized-exact':
            return 'Normalized stack is identical';
        case 'common-tail':
            return `${sharedTailFrames} shared tail frame${sharedTailFrames === 1 ? '' : 's'}`;
        case 'shifted-subsequence':
            return `${contiguousRunLength} contiguous shared frame${contiguousRunLength === 1 ? '' : 's'} at shifted depth`;
        case 'near-sequence':
            return `${sharedOrderedFrames} shared ordered frame${sharedOrderedFrames === 1 ? '' : 's'}`;
        case 'frame-overlap':
            return `${sharedFrames} shared frame${sharedFrames === 1 ? '' : 's'}`;
        default:
            return 'Merged into existing variant';
    }
}

function scoreRunnableStackSimilarityDetailed(a, b) {
    if (!a || !b) {
        return {
            score: 0,
            method: 'variant-merge',
            summary: 'No similarity data',
            metrics: {}
        };
    }

    const aFrames = a.meaningfulFrames || [];
    const bFrames = b.meaningfulFrames || [];
    const aApp = a.appFrames || [];
    const bApp = b.appFrames || [];

    const normalizedExact =
        aFrames.length > 0 &&
        bFrames.length > 0 &&
        aFrames.join(' | ') === bFrames.join(' | ');

    const prefixScore = commonPrefixScore(aFrames, bFrames, 6);
    const tailScore = commonSuffixScore(aFrames, bFrames, 12);
    const sequenceScore = orderedSequenceScore(aFrames, bFrames, 12);
    const frameOverlapScore = jaccardScore(aFrames, bFrames, 12);
    const appOverlapScore = jaccardScore(aApp, bApp, 8);

    const contiguous = longestCommonContiguousSubsequenceScore(aFrames, bFrames, 12);
    const contiguousRunLength = Number(contiguous.runLength || 0);
    const contiguousScore = Number(contiguous.score || 0);

    const sharedTailFrames = countSharedTailFrames(aFrames, bFrames, 12);
    const sharedOrderedFrames = countSharedOrderedFrames(aFrames, bFrames, 12);
    const sharedFrames = countSharedFrames(aFrames, bFrames, 12);

    let method = 'variant-merge';
    let score = 0;

    if (normalizedExact) {
        method = 'normalized-exact';
        score = 1;
    } else {
        const commonTailScore =
            (tailScore * 0.55) +
            (contiguousScore * 0.25) +
            (sequenceScore * 0.10) +
            (frameOverlapScore * 0.10);

        const shiftedSubsequenceScore =
            (contiguousScore * 0.55) +
            (sequenceScore * 0.20) +
            (frameOverlapScore * 0.15) +
            (appOverlapScore * 0.10);

        const nearSequenceScore =
            (sequenceScore * 0.50) +
            (contiguousScore * 0.20) +
            (prefixScore * 0.10) +
            (appOverlapScore * 0.10) +
            (frameOverlapScore * 0.10);

        const frameOverlapCompositeScore =
            (frameOverlapScore * 0.60) +
            (appOverlapScore * 0.20) +
            (sequenceScore * 0.10) +
            (contiguousScore * 0.10);

        const candidates = [
            { method: 'common-tail', score: commonTailScore },
            { method: 'shifted-subsequence', score: shiftedSubsequenceScore },
            { method: 'near-sequence', score: nearSequenceScore },
            { method: 'frame-overlap', score: frameOverlapCompositeScore }
        ].sort((x, y) => y.score - x.score);

        method = candidates[0]?.method || 'variant-merge';
        score = candidates[0]?.score || 0;

        if (method === 'common-tail' && sharedTailFrames < 2 && contiguousRunLength >= 4) {
            method = 'shifted-subsequence';
            score = shiftedSubsequenceScore;
        }

        if (method === 'frame-overlap' && sharedFrames < 2) {
            method = 'variant-merge';
            score = Math.min(score, 0.55);
        }
    }

    score = Math.max(0, Math.min(1, score));

    const metrics = {
        normalizedExact,
        prefixScore,
        tailScore,
        sequenceScore,
        frameOverlapScore,
        appOverlapScore,
        sharedTailFrames,
        sharedOrderedFrames,
        sharedFrames,
        contiguousRunLength,
        contiguousScore
    };

    return {
        score,
        method,
        summary: formatSimilaritySummary(method, metrics),
        metrics
    };
}

function scoreRunnableStackSimilarity(a, b) {
    return scoreRunnableStackSimilarityDetailed(a, b).score;
}

function calculateLongestConsecutiveRun(sortedIndexes) {
    if (!Array.isArray(sortedIndexes) || sortedIndexes.length === 0) return 0;

    let best = 1;
    let current = 1;

    for (let i = 1;i < sortedIndexes.length;i++) {
        if (sortedIndexes[i] === sortedIndexes[i - 1] + 1) {
            current += 1;
            best = Math.max(best, current);
        } else {
            current = 1;
        }
    }

    return best;
}



function normalizeRunnableCompareLine(line) {
    let s = String(line || '').trim();
    if (!s) return '';

    // Normalize stack frames
    if (s.startsWith('at ')) {
        s = s.replace(/:\d+\)/g, ')');               // remove source line numbers
        s = s.replace(/\$\$Lambda\/0x[0-9a-fA-F]+/g, '$$Lambda');
        s = s.replace(/0x[0-9a-fA-F]+/g, '0x');      // normalize lock-like ids in frames if present
    }

    // Normalize monitor/lock lines
    if (s.startsWith('- locked <') || s.startsWith('- waiting to lock <')) {
        s = s.replace(/<0x[0-9a-fA-F]+>/g, '<0x>');
    }

    // Collapse whitespace
    s = s.replace(/\s+/g, ' ').trim();
    return s;
}



function summarizeClusterMatchQuality(cluster) {
    const members = Array.isArray(cluster?.members) ? cluster.members : [];
    const representative = cluster?.representative;

    if (!representative || members.length <= 1) {
        return {
            averageSimilarity: 1,
            label: 'Exact-ish',
            dominantMethod: 'normalized-exact',
            methodBreakdown: [{ method: 'normalized-exact', count: members.length || 1 }]
        };
    }

    let total = 0;
    let count = 0;
    const methodCounts = new Map();

    for (let i = 0;i < members.length;i++) {
        const member = members[i];
        const score = Number(member?.clusterMatchScore ?? 1);
        const method = String(member?.clusterMatchMethod || 'Normalized exact');

        total += score;
        count += 1;

        methodCounts.set(method, (methodCounts.get(method) || 0) + 1);
    }

    const avg = count === 0 ? 1 : total / count;
    const methodBreakdown = Array.from(methodCounts.entries())
        .map(([method, methodCount]) => ({ method, count: methodCount }))
        .sort((a, b) => b.count - a.count || a.method.localeCompare(b.method));

    return {
        averageSimilarity: avg,
        label:
            avg >= 0.90 ? 'Very tight' :
                avg >= 0.78 ? 'Similar' :
                    'Loose',
        dominantMethod: methodBreakdown[0]?.method || 'variant-merge',
        methodBreakdown
    };
}

function longestOrderedWindowScore(aFrames, bFrames, maxOffset = 3, maxDepth = 8) {
    const a = (Array.isArray(aFrames) ? aFrames : []).slice(0, maxDepth);
    const b = (Array.isArray(bFrames) ? bFrames : []).slice(0, maxDepth);

    if (!a.length || !b.length) return 0;

    let best = 0;
    const denom = Math.max(Math.min(a.length, maxDepth), Math.min(b.length, maxDepth), 1);

    for (let aStart = 0;aStart < Math.min(a.length, maxOffset + 1);aStart++) {
        for (let bStart = 0;bStart < Math.min(b.length, maxOffset + 1);bStart++) {
            let run = 0;

            while (
                aStart + run < a.length &&
                bStart + run < b.length &&
                run < maxDepth &&
                a[aStart + run] === b[bStart + run]
            ) {
                run += 1;
            }

            best = Math.max(best, run);
        }
    }

    return best / denom;
}

function countSharedTopAppFrames(a, b, maxDepth = 8) {
    const aFrames = (a?.appFrames || []).slice(0, maxDepth);
    const bFrames = (b?.appFrames || []).slice(0, maxDepth);

    if (!aFrames.length || !bFrames.length) return 0;

    const bSet = new Set(bFrames);
    let count = 0;

    for (const frame of aFrames) {
        if (bSet.has(frame)) count += 1;
    }

    return count;
}

function classifyRunnableStackMatch(a, b) {
    if (!a || !b) {
        return {
            method: 'None',
            score: 0,
            summary: 'No match'
        };
    }

    const aMeaningful = a.meaningfulFrames || [];
    const bMeaningful = b.meaningfulFrames || [];
    const aApp = a.appFrames || [];
    const bApp = b.appFrames || [];

    const exactA = aMeaningful.slice(0, 8).join(' | ');
    const exactB = bMeaningful.slice(0, 8).join(' | ');

    if (exactA && exactA === exactB) {
        return {
            method: 'Normalized exact',
            score: 1.0,
            summary: 'Top normalized frames are identical'
        };
    }

    const prefix = commonPrefixScore(aMeaningful, bMeaningful, 6);
    if (prefix >= 0.80) {
        return {
            method: 'Common prefix',
            score: prefix,
            summary: `${Math.round(prefix * 100)}% shared prefix`
        };
    }

    const shifted = longestOrderedWindowScore(aMeaningful, bMeaningful, 3, 8);
    if (shifted >= 0.60) {
        return {
            method: 'Shifted window',
            score: shifted,
            summary: `${Math.round(shifted * 100)}% ordered window overlap`
        };
    }

    const commonSuffix = longestCommonSuffixFrames(aMeaningful, bMeaningful, 16);
    const sharedTopAppFrames = countSharedTopAppFrames(a, b, 8);

    if (commonSuffix >= 10 && sharedTopAppFrames >= 2) {
        const score = Math.min(0.85, 0.45 + (commonSuffix * 0.02) + (sharedTopAppFrames * 0.08));
        return {
            method: 'Shared execution tail',
            score,
            summary: `${commonSuffix} shared tail frames`
        };
    }

    const looseScore = scoreRunnableStackSimilarity(a, b);
    return {
        method: 'Loose similarity',
        score: looseScore,
        summary: 'Heuristic similarity only'
    };
}

function longestCommonSuffixFrames(aFrames, bFrames, maxDepth = 16) {
    const a = (Array.isArray(aFrames) ? aFrames : []).slice(-maxDepth);
    const b = (Array.isArray(bFrames) ? bFrames : []).slice(-maxDepth);

    let count = 0;
    let ai = a.length - 1;
    let bi = b.length - 1;

    while (ai >= 0 && bi >= 0) {
        if (a[ai] !== b[bi]) break;
        count += 1;
        ai -= 1;
        bi -= 1;
    }

    return count;
}

function longestCommonContiguousSubsequenceScore(aFrames, bFrames, maxDepth = 12) {
    const a = (Array.isArray(aFrames) ? aFrames : []).slice(0, maxDepth);
    const b = (Array.isArray(bFrames) ? bFrames : []).slice(0, maxDepth);

    if (!a.length || !b.length) return { score: 0, runLength: 0 };

    let best = 0;

    for (let i = 0;i < a.length;i++) {
        for (let j = 0;j < b.length;j++) {
            let run = 0;
            while (
                i + run < a.length &&
                j + run < b.length &&
                a[i + run] === b[j + run]
            ) {
                run += 1;
            }
            if (run > best) best = run;
        }
    }

    return {
        runLength: best,
        score: best / Math.max(Math.min(a.length, maxDepth), Math.min(b.length, maxDepth), 1)
    };
}

function hasAnyMeaningfulFrameOverlap(a, b, maxDepth = 8) {
    const aSet = new Set((a.meaningfulFrames || []).slice(0, maxDepth));
    const bList = (b.meaningfulFrames || []).slice(0, maxDepth);

    for (const frame of bList) {
        if (aSet.has(frame)) return true;
    }
    return false;
}

function shouldPrefilterRunnableClusterMatch(thread, representative) {
    const threadFrames = thread?.meaningfulFrames || [];
    const representativeFrames = representative?.meaningfulFrames || [];

    const threadTopMeaningful = threadFrames[0] || '';
    const representativeTopMeaningful = representativeFrames[0] || '';

    const threadTopApp = thread?.appFrames?.[0] || '';
    const representativeTopApp = representative?.appFrames?.[0] || '';

    const threadTail3 = threadFrames.slice(-3).join(' | ');
    const representativeTail3 = representativeFrames.slice(-3).join(' | ');

    const threadTail5 = threadFrames.slice(-5).join(' | ');
    const representativeTail5 = representativeFrames.slice(-5).join(' | ');

    const contiguous = longestCommonContiguousSubsequenceScore(threadFrames, representativeFrames, 12);

    return Boolean(
        (threadTopApp && representativeTopApp && threadTopApp === representativeTopApp) ||
        (threadTopMeaningful && representativeTopMeaningful && threadTopMeaningful === representativeTopMeaningful) ||
        (threadTail3 && representativeTail3 && threadTail3 === representativeTail3) ||
        (threadTail5 && representativeTail5 && threadTail5 === representativeTail5) ||
        contiguous.runLength >= 4 ||
        hasAnyMeaningfulFrameOverlap(thread, representative, 10) ||
        longestOrderedWindowScore(threadFrames, representativeFrames, 4, 10) >= 0.30
    );
}

function shouldExcludeFromRunnableClusters(thread) {
    return (
        isJvmInternalThreadName(thread.threadName) ||
        isSelectorOrEventLoopThread(thread)
    );
}

function buildRunnableStackClusters(dumps) {
    if (!Array.isArray(dumps) || dumps.length <= 1) return [];

    const candidates = [];

    dumps.forEach((dump) => {
        (dump.threads || []).forEach((thread) => {
            if (shouldExcludeFromRunnableClusters(thread)) return;
            if (thread.javaState !== 'RUNNABLE') return;

            const hasMeaningful =
                Array.isArray(thread.meaningfulFrames) &&
                thread.meaningfulFrames.length > 0;

            if (!hasMeaningful) return;

            candidates.push(thread);
        });
    });

    if (candidates.length === 0) return [];

    const clusters = [];
    const candidateIndex = createClusterCandidateIndex();
    const ASSIGNMENT_SIMILARITY_THRESHOLD = 0.42;

    for (const thread of candidates) {
        let bestCluster = null;
        let bestScore = -1;
        let bestMatch = null;

        for (const cluster of candidateIndex.matching(thread)) {
            const representative = cluster.representative;

            const prefilterMatch =
                hasAnyMeaningfulFrameOverlap(thread, representative, 8) ||
                longestOrderedWindowScore(
                    thread.meaningfulFrames || [],
                    representative.meaningfulFrames || [],
                    3,
                    8
                ) >= 0.35 ||
                longestCommonSuffixFrames(
                    thread.meaningfulFrames || [],
                    representative.meaningfulFrames || [],
                    16
                ) >= 10;

            if (!prefilterMatch) continue;

            const match = scoreRunnableStackSimilarityDetailed(thread, representative);
            const score = match.score;

            if (score > bestScore) {
                bestScore = score;
                bestCluster = cluster;
                bestMatch = match;
            }
        }

        const rejectWeakSharedTail =
            bestMatch &&
            bestMatch.method === 'common-tail' &&
            bestMatch.score < 0.72;

        if (!bestCluster || bestScore < ASSIGNMENT_SIMILARITY_THRESHOLD || rejectWeakSharedTail) {
            thread.clusterMatchMethod = 'normalized-exact';
            thread.clusterMatchScore = 1.0;
            thread.clusterMatchSummary = 'Cluster representative';

            clusters.push({
                id: `runnable-cluster-${clusters.length + 1}`,
                representative: thread,
                members: [thread],
                seenDumpIndexes: new Set([thread.dumpIndex]),
                dumpCounts: new Map([[thread.dumpIndex, 1]])
            });
            candidateIndex.add(clusters.at(-1));
            continue;
        }

        thread.clusterMatchMethod = bestMatch.method;
        thread.clusterMatchScore = bestMatch.score;
        thread.clusterMatchSummary = bestMatch.summary;

        bestCluster.members.push(thread);
        bestCluster.seenDumpIndexes.add(thread.dumpIndex);
        bestCluster.dumpCounts.set(
            thread.dumpIndex,
            (bestCluster.dumpCounts.get(thread.dumpIndex) || 0) + 1
        );
    }

    return clusters
        .map((cluster) => {
            const seenDumpIndexes = Array.from(cluster.seenDumpIndexes).sort((a, b) => a - b);

            const perDump = seenDumpIndexes.map((dumpIndex) => ({
                dumpIndex,
                count: cluster.dumpCounts.get(dumpIndex) || 0,
                timestamp: dumps[dumpIndex]?.timestamp || `Dump ${dumpIndex + 1}`
            }));

            const quality = summarizeClusterMatchQuality(cluster);
            const timeline = buildClusterTimeline({ perDump }, dumps.length, dumps);
            const trend = classifyClusterTrend(timeline);

            const methodCounts = new Map();
            for (const member of cluster.members) {
                const method = member.clusterMatchMethod || 'Unknown';
                methodCounts.set(method, (methodCounts.get(method) || 0) + 1);
            }

            const methodBreakdown = Array.from(methodCounts.entries())
                .map(([method, count]) => ({ method, count }))
                .sort((a, b) => b.count - a.count);

            const primaryMethod = methodBreakdown[0]?.method || 'Unknown';

            return {
                ...cluster,
                perDump,
                timeline,
                trend,
                seenDumpIndexes,
                dumpCountSeen: seenDumpIndexes.length,
                totalOccurrences: cluster.members.length,
                longestConsecutiveRun: calculateLongestConsecutiveRun(seenDumpIndexes),
                representativeFrames: cluster.representative.clusterRepresentativeFrames || [],
                quality,
                primaryMethod,
                methodBreakdown
            };
        })
        .filter((cluster) => cluster.dumpCountSeen >= 2)
        .sort((a, b) => {
            if (b.dumpCountSeen !== a.dumpCountSeen) return b.dumpCountSeen - a.dumpCountSeen;
            if (b.longestConsecutiveRun !== a.longestConsecutiveRun) {
                return b.longestConsecutiveRun - a.longestConsecutiveRun;
            }
            return b.totalOccurrences - a.totalOccurrences;
        });
}

function buildParsedDump(snapshot) {
    const threads = snapshot.parsedThreads || parseThreadDump(snapshot.rawText, { snapshotIndex: snapshot.index });
    const deadlocks = parseDeadlocks(snapshot.rawText);

    threads.forEach((t, i) => {
        t.index = i + 1;
        t.isCarrierThread = Boolean(t.isCarrierThread);
        t.carrierVirtualThreadId = t.carrierVirtualThreadId || null;
        t.mountedVirtualThreadId = t.mountedVirtualThreadId || null;
        t.locksHeldCount = Number.isFinite(t.locksHeldCount) ? t.locksHeldCount : 0;

        enrichThreadStackSimilarityFields(t, snapshot.index);
    });
    const identityWarnings = annotateDeadlocks(threads, deadlocks);

    const classInitializationAnalysis = analyzeClassInitialization(threads);
    const classInitializationChains = classInitializationAnalysis.chains;
    const contentionChains = buildLockContentionChains(threads);
    annotateThreadsWithContention(threads, contentionChains);

    return {
        ...snapshot,
        threads,
        deadlocks,
        classInitializationChains,
        contentionChains,
        diagnostics: {
            ...(snapshot.diagnostics || {}),
            identityWarnings,
        },
    };
}

function annotateThreadDiagnostics(dumps, cpuThresholds) {
    for (const dump of dumps || []) {
        for (const thread of dump.threads || []) {
            classifyThreadScenario(thread, cpuThresholds);
            thread.findings = collectThreadFindings(thread, cpuThresholds);
        }
    }
    return dumps;
}

function countByState(threads) {
    const counts = new Map();
    for (const t of threads || []) {
        const key = String(t.javaState || 'UNKNOWN');
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
}

function buildDumpDelta(currentDump, previousDump) {
    if (!currentDump || !previousDump) return null;

    const currStates = countByState(currentDump.threads);
    const prevStates = countByState(previousDump.threads);

    const currDeadlocked = (currentDump.threads || []).filter((t) => t.isDeadlocked).length;
    const prevDeadlocked = (previousDump.threads || []).filter((t) => t.isDeadlocked).length;

    const currBlocked = currStates.get('BLOCKED') || 0;
    const prevBlocked = prevStates.get('BLOCKED') || 0;

    const currRunnable = currStates.get('RUNNABLE') || 0;
    const prevRunnable = prevStates.get('RUNNABLE') || 0;

    const currWaiting =
        (currStates.get('WAITING') || 0) +
        (currStates.get('TIMED_WAITING') || 0);

    const prevWaiting =
        (prevStates.get('WAITING') || 0) +
        (prevStates.get('TIMED_WAITING') || 0);
    const collectionsComparable = canCompareThreadCollections(previousDump, currentDump);

    return {
        threadsDelta: collectionsComparable ? (currentDump.threads?.length || 0) - (previousDump.threads?.length || 0) : null,
        blockedDelta: collectionsComparable ? currBlocked - prevBlocked : null,
        runnableDelta: collectionsComparable ? currRunnable - prevRunnable : null,
        waitingDelta: collectionsComparable ? currWaiting - prevWaiting : null,
        deadlockedDelta: collectionsComparable ? currDeadlocked - prevDeadlocked : null
    };
}

function annotateDumpDeltas(dumps) {
    for (let i = 0;i < dumps.length;i++) {
        dumps[i].delta = i === 0 ? null : buildDumpDelta(dumps[i], dumps[i - 1]);
    }
    return dumps;
}

function getThreadStackText(thread) {
    return (thread?.rawBlock || []).join('\n');
}

function getThreadFrameText(thread) {
    return extractNormalizedFrames(thread).join('\n');
}

function stackIncludes(thread, pattern) {
    return pattern.test(getThreadStackText(thread));
}

function isReferenceHandlerStack(thread) {
    const stack = getThreadStackText(thread);
    return /java\.lang\.ref\.Reference\.waitForReferencePendingList/.test(stack) &&
        /java\.lang\.ref\.Reference\$ReferenceHandler\.run/.test(stack);
}

function isSelectorOrEventLoopThread(thread) {
    return isGenericSelectorOrEventLoopThread(thread);
}

function isJvmInternalThreadName(name) {
    const threadName = String(name || '');

    return (
        threadName === 'DestroyJavaVM' ||
        threadName === 'VM Thread' ||
        threadName === 'Reference Handler' ||
        threadName === 'Finalizer' ||
        threadName === 'Signal Dispatcher' ||
        threadName === 'Attach Listener' ||
        threadName === 'Service Thread' ||
        threadName === 'Monitor Deflation Thread' ||
        threadName === 'Notification Thread' ||
        threadName === 'Common-Cleaner' ||
        threadName.startsWith('GC Thread#') ||
        threadName.startsWith('G1 ') ||
        threadName.startsWith('C1 CompilerThread') ||
        threadName.startsWith('C2 CompilerThread')
    );
}

function collectThreadFindings(thread, cpuThresholds) {
    const findings = [];
    const stack = getThreadStackText(thread);
    const frameText = getThreadFrameText(thread);
    const name = String(thread.threadName || '');
    const infrastructureThread = isSelectorOrEventLoopThread(thread);
    const cpuEvidence = evaluateMeasuredCpu(thread, {
        kind: infrastructureThread ? 'infrastructure' : 'application',
        thresholds: cpuThresholds,
    });
    const allocationEvidence = evaluateAllocationRate(thread);

    const addFinding = (key, label, reason, confidence = 'medium', severity = 'info') => {
        findings.push({
            key,
            label,
            reason,
            confidence,
            severity,
            evidence: diagnosticEvidenceFor(key),
        });
    };

    if (isJvmInternalThreadName(name)) {
        return findings;
    }

    if (!infrastructureThread && cpuEvidence.hotFinding) {
        addFinding(
            'cpu-hot',
            'CPU hot',
            cpuEvidence.reason,
            cpuEvidence.findingConfidence,
            cpuEvidence.findingSeverity
        );
    }

    if (allocationEvidence.hotFinding) {
        addFinding(
            'allocation-hot',
            'Allocation hot',
            allocationEvidence.reason,
            allocationEvidence.hotScenario ? allocationEvidence.confidence : 'medium',
            allocationEvidence.hotScenario ? allocationEvidence.severity : 'medium',
        );
    }

    if (isPossibleLivelockCandidate(thread, { stackText: frameText, thresholds: cpuThresholds })) {
        addFinding(
            'possible-livelock',
            'Possible livelock',
            `Runnable retry/coordination path with measured ${thread.cpuRatePercent.toFixed(1)}% CPU since the previous snapshot; heuristic only`,
            'low',
            'medium',
        );
    }

    // Contention hotspot finding
    if ((thread.blockedWaiterCount || 0) >= 3) {
        addFinding(
            'many-waiters',
            'Many waiters',
            `${thread.blockedWaiterCount} blocked waiter(s) depend on this thread`,
            'medium',
            'medium'
        );
    }

    const lockAssessment = thread.lockAssessment;
    if (lockAssessment?.tier === 'likely-blocker') {
        const waiterCount = lockAssessment.likelyBlockers
            .reduce((total, blocker) => total + Number(blocker.waiterCount || 0), 0);
        addFinding(
            'likely-lock-bottleneck',
            'Likely lock bottleneck',
            `${waiterCount} observed waiter(s) depend on locks held by this thread; severity score ${lockAssessment.severityScore}/100`,
            'low',
            lockAssessment.severity,
        );
    }

    if (infrastructureThread && cpuEvidence.hotFinding) {
        addFinding(
            'infra-hot',
            'Hot infrastructure thread',
            `Selector/event-loop thread: ${cpuEvidence.reason}`,
            cpuEvidence.findingConfidence,
            cpuEvidence.findingSeverity
        );
    }

    return findings;
}

function classifyThreadScenario(thread, cpuThresholds) {
    const stack = getThreadStackText(thread);
    const frameText = getThreadFrameText(thread);
    const state = String(thread.javaState || '');
    const name = String(thread.threadName || '');
    const selectorPattern = evaluateSelectorOrEventLoopPattern(thread);
    const infrastructureThread = Boolean(selectorPattern);
    const runtimePatterns = evaluateRuntimeStackPatterns(thread);
    const runtimeCandidates = [runtimePatterns.primary, ...runtimePatterns.alternates].filter(Boolean);
    const runtimePattern = (key) => runtimeCandidates.find((candidate) => candidate.key === key) || null;
    const cpuEvidence = evaluateRunnableCpu(thread, {
        kind: infrastructureThread ? 'infrastructure' : 'application',
        hasBlockingPrimitive: /Unsafe\.park|LockSupport\.park|Object\.wait|Thread\.sleep/.test(stack),
        thresholds: cpuThresholds,
    });
    const allocationEvidence = evaluateAllocationRate(thread);
    thread.scenarioKey = null;
    thread.scenarioLabel = null;
    thread.scenarioReason = null;
    thread.scenarioConfidence = null;
    thread.scenarioSeverity = null;
    thread.scenarioEvidence = null;
    thread.scenarioPatternScore = null;
    thread.scenarioPatternSignals = [];
    thread.scenarioPatternConflicts = [];
    thread.scenarioMatchedFrames = [];
    thread.scenarioAlternatePatterns = [];

    const setScenario = (
        key,
        label,
        reason,
        confidence = 'medium',
        severity = 'info',
        pattern = null,
        alternates = [],
    ) => {
        thread.scenarioKey = key;
        thread.scenarioLabel = label;
        thread.scenarioReason = reason;
        thread.scenarioConfidence = confidence;
        thread.scenarioSeverity = severity;
        thread.scenarioEvidence = diagnosticEvidenceFor(key);
        thread.scenarioPatternScore = pattern?.score ?? null;
        thread.scenarioPatternSignals = pattern?.signals || [];
        thread.scenarioPatternConflicts = pattern?.conflicts || [];
        thread.scenarioMatchedFrames = pattern?.matchedFrames || [];
        thread.scenarioAlternatePatterns = alternates.map((alternate) => ({
            key: alternate.key,
            label: alternate.label,
            score: alternate.score,
            confidence: alternate.confidence,
        }));
    };

    // 1. Confirmed JVM deadlock
    if (thread.isDeadlocked) {
        setScenario(
            'deadlock',
            'Java deadlock',
            `Confirmed deadlock cycle ${thread.deadlockCycleId ?? '—'}`,
            'high',
            'critical'
        );
        return;
    }

    // 2. Explicit class-initialization relationships. The wait itself is a JVM
    // fact; a stalled initializer remains a snapshot-only candidate.
    const classInitializationRelations = Array.isArray(thread.classInitializationChains)
        ? thread.classInitializationChains : [];
    const initializerRelations = classInitializationRelations
        .filter((entry) => entry.role === 'initializer')
        .sort((left, right) => Number(right.chain?.waiterCount || 0) - Number(left.chain?.waiterCount || 0));
    const initializerRelation = initializerRelations[0];
    if (initializerRelation?.chain?.stallCandidate) {
        const chain = initializerRelation.chain;
        const waitingResource = chain.initializerWaitingResources?.[0];
        const waitingText = waitingResource
            ? ` while waiting on ${waitingResource.lockType || waitingResource.lockId || 'a JVM resource'}`
            : ` while in ${chain.initializerState || state || 'UNKNOWN'}`;
        setScenario(
            'class-initialization-stall',
            'Class initialization stall candidate',
            `${chain.waiterCount} thread(s) wait for ${chain.className}${waitingText}; snapshot evidence only`,
            'medium',
            'high'
        );
        return;
    }

    const classInitializationWaiter = classInitializationRelations.find((entry) => entry.role === 'waiter');
    if (classInitializationWaiter) {
        const chain = classInitializationWaiter.chain;
        const initializerText = chain?.initializer
            ? `; initializer ${chain.initializer.threadName || 'unknown'} is ${chain.initializerState || 'UNKNOWN'}`
            : chain?.status === 'ambiguous-initializer'
                ? '; initializer could not be resolved uniquely'
                : '; initializer was not observed in this snapshot';
        setScenario(
            'class-initialization-wait',
            'Class initialization wait',
            `Waiting for ${chain?.className || 'a class'} initialization${initializerText}`,
            'high',
            chain?.stallCandidate ? 'high' : 'medium'
        );
        return;
    }

    if (initializerRelation) {
        const chain = initializerRelation.chain;
        setScenario(
            'class-initializer-with-waiters',
            'Class initializer with waiters',
            `${chain?.waiterCount || 0} thread(s) wait for ${chain?.className || 'this class'} initialization`,
            'high',
            'medium'
        );
        return;
    }

    // 3. Classic monitor contention
    if (state === 'BLOCKED' && thread.waitingToLock?.lockId) {
        setScenario(
            'monitor-contention',
            'Monitor contention',
            `BLOCKED waiting to lock ${thread.waitingToLock.lockId}`,
            'high',
            'high'
        );
        return;
    }

    // 4–9. Generic JVM and standard-library synchronization paths.
    const synchronizationPatterns = evaluateSynchronizationPatterns(thread);
    const synchronizationScenario = synchronizationPatterns.primary;
    if (synchronizationScenario) {
        setScenario(
            synchronizationScenario.key,
            synchronizationScenario.label,
            synchronizationScenario.reason,
            synchronizationScenario.confidence,
            synchronizationScenario.severity,
            synchronizationScenario,
            synchronizationPatterns.alternates,
        );
        return;
    }

    // 9. Sleeping
    const sleepingPattern = runtimePattern('sleeping');
    if (sleepingPattern) {
        setScenario(
            'sleeping',
            'Sleeping',
            sleepingPattern.reason,
            sleepingPattern.confidence,
            sleepingPattern.severity,
            sleepingPattern,
        );
        return;
    }

    // 10. Carrier thread
    if (thread.isCarrierThread) {
        setScenario(
            'carrier-thread',
            'Carrier thread',
            `Platform thread observed carrying virtual thread(s) ${observedVirtualThreadIds(thread).map(id => `#${id}`).join(', ')}`,
            'high',
            'info'
        );
        return;
    }

    // 11. Idle executor / pool worker
    const executorPattern = runtimePattern('executor-idle');
    if (executorPattern) {
        setScenario(
            'executor-idle',
            'Executor idle',
            executorPattern.reason,
            executorPattern.confidence,
            executorPattern.severity,
            executorPattern,
        );
        return;
    }



    // JVM infrastructure threads should never be flagged CPU hot
    if (isJvmInternalThreadName(name)) {
        const internalReason =
            name === 'Reference Handler' || isReferenceHandlerStack(thread)
                ? 'JVM reference-processing thread; normally expected and not an application hotspot by itself'
                : 'JVM infrastructure thread';

        setScenario(
            'jvm-internal',
            'JVM internal thread',
            internalReason,
            'high',
            'info'
        );
        return;
    }



    // 12. Selector / event-loop infrastructure thread
    if (infrastructureThread) {
        if (cpuEvidence.hotScenario) {
            setScenario(
                'hot-selector-event-loop',
                'Hot selector/event loop',
                `Selector/event-loop thread: ${cpuEvidence.reason}`,
                cpuEvidence.scenarioConfidence,
                cpuEvidence.scenarioSeverity,
                selectorPattern,
            );
            return;
        }

        setScenario(
            'selector-event-loop',
            'Selector/event loop',
            `${selectorPattern.reason}; usually expected unless CPU stays elevated`,
            selectorPattern.confidence,
            'info',
            selectorPattern,
        );
        return;
    }
    // 12.1 Measured allocation throughput. This does not imply retention or a leak.
    if (allocationEvidence.hotScenario) {
        setScenario(
            'allocation-hot',
            'Allocation hot',
            allocationEvidence.reason,
            allocationEvidence.confidence,
            allocationEvidence.severity,
        );
        return;
    }

    // 12.2 CPU hot / hot spin candidate
    if (cpuEvidence.hotScenario) {
        setScenario(
            'cpu-hot',
            'CPU hot',
            `${cpuEvidence.reason}; RUNNABLE with no obvious blocking primitive`,
            cpuEvidence.scenarioConfidence,
            cpuEvidence.scenarioSeverity
        );
        return;
    }

    // 12.3 Possible livelock (heuristic only).
    if (isPossibleLivelockCandidate(thread, { stackText: frameText, thresholds: cpuThresholds })) {
        setScenario(
            'possible-livelock',
            'Possible livelock',
            `Runnable retry/coordination path with measured ${thread.cpuRatePercent.toFixed(1)}% CPU since the previous snapshot (configured livelock threshold ${cpuThresholds.livelockPercent.toFixed(1)}%); heuristic only`,
            'low',
            'medium'
        );
        return;
    }

    // 13. Possible starvation
    if (isPossibleStarvationCandidate(thread)) {
        setScenario(
            'possible-starvation',
            'Possible starvation',
            'The same lock holder has at least three waiters at both adjacent snapshot endpoints; uninterrupted waiting and starvation are not established',
            'low',
            'medium'
        );
        return;
    }

    // 14. Generic parked thread
    const parkedPattern = runtimePattern('parked');
    if (parkedPattern) {
        setScenario(
            'parked',
            'Parked',
            parkedPattern.reason,
            parkedPattern.confidence,
            parkedPattern.severity,
            parkedPattern,
        );
        return;
    }
}

function buildLockContentionChains(threads) {
    const ownersByLockId = new Map();
    const waitersByLockId = new Map();

    for (const t of threads || []) {
        for (const lm of (t.heldLocks || [])) {
            if (!lm?.lockId) continue;

            if (!ownersByLockId.has(lm.lockId)) {
                ownersByLockId.set(lm.lockId, {
                    lockId: lm.lockId,
                    lockType: lm.lockType || null,
                    owners: [],
                });
            }

            ownersByLockId.get(lm.lockId).owners.push(t);
        }

        for (const waiting of (t.waitingLocks || []).filter((lock) => lock.kind === 'monitor-enter' || lock.kind === 'synchronizer-park')) {
            if (!waitersByLockId.has(waiting.lockId)) {
                waitersByLockId.set(waiting.lockId, {
                    lockId: waiting.lockId,
                    lockType: waiting.lockType || null,
                    waiters: [],
                });
            }

            waitersByLockId.get(waiting.lockId).waiters.push(t);
        }
    }


    const allLockIds = new Set([
        ...ownersByLockId.keys(),
        ...waitersByLockId.keys(),
    ]);

    const chains = [];

    for (const lockId of allLockIds) {
        const ownerEntry = ownersByLockId.get(lockId);
        const waiterEntry = waitersByLockId.get(lockId);

        const owners = ownerEntry?.owners || [];
        const waiters = waiterEntry?.waiters || [];

        if (owners.length === 0 || waiters.length === 0) continue;

        const lockType = ownerEntry?.lockType || waiterEntry?.lockType || null;

        const uniqueOwners = Array.from(new Map(
            owners.map((t) => [t.sourceKey, t])
        ).values());

        const uniqueWaiters = Array.from(new Map(
            waiters.map((t) => [t.sourceKey, t])
        ).values());


        chains.push({
            lockId,
            lockType,
            owners: uniqueOwners,
            waiters: uniqueWaiters,
        });
    }

    chains.sort((a, b) => {
        const waiterDiff = (b.waiters?.length || 0) - (a.waiters?.length || 0);
        if (waiterDiff !== 0) return waiterDiff;
        return String(a.lockId).localeCompare(String(b.lockId));
    });

    return chains;
}

function annotateThreadsWithContention(threads, chains) {
    for (const t of threads || []) {
        t.contentionChains = [];
        t.waitingOnThreadNames = [];
        t.blockingThreadNames = [];
        t.blockedWaiterCount = 0;
    }

    for (const chain of chains || []) {
        const ownerNames = (chain.owners || []).map((t) => t.threadName).filter(Boolean);
        const waiterNames = (chain.waiters || []).map((t) => t.threadName).filter(Boolean);

        for (const owner of chain.owners || []) {
            owner.contentionChains.push(chain);
            owner.blockedWaiterCount += waiterNames.length;
            owner.waitingOnThreadNames = owner.waitingOnThreadNames || [];
            owner.blockingThreadNames = Array.from(new Set([
                ...(owner.blockingThreadNames || []),
                ...waiterNames,
            ]));
        }

        for (const waiter of chain.waiters || []) {
            waiter.contentionChains.push(chain);
            waiter.waitingOnThreadNames = Array.from(new Set([
                ...(waiter.waitingOnThreadNames || []),
                ...ownerNames,
            ]));
        }
    }
}

export { scoreRunnableStackSimilarityDetailed, normalizeRunnableCompareLine };

export function analyzeThreadDumpData(text, cpuThresholds = getRunnableCpuThresholdProfile('balanced').thresholds) {
    // Structured cloning removes the validation marker; validate once per worker job.
    cpuThresholds = createRunnableCpuThresholds(cpuThresholds);
    const session = Array.isArray(text) ? parseThreadDumpSession(text) : null;
    const parserResult = session?.parserResult || analyzeThreadDump(text);
    const sourceMetadata = session ? { sourceResults: session.sourceResults } : {};
    if (parserResult.status === 'empty' || parserResult.status === 'unsupported') {
        return { ...sourceMetadata, parserResult, parsedDumps: [], threadSeries: [], runnableStackClusters: [] };
    }
    const snapshots = annotateSnapshotTimes(parserResult.snapshots.map(buildParsedDump));
    const correlation = correlateThreadsAcrossSnapshots(snapshots);
    const temporalAnalysis = annotateCpuRates(correlation.dumps, correlation.series);
    const lockAnalysis = annotateLockPrecedence(temporalAnalysis.dumps, temporalAnalysis.series);
    const changeAnalysis = annotateThreadChanges(lockAnalysis.dumps, lockAnalysis.series, { cpuThresholds });
    const diagnosticDumps = annotateThreadDiagnostics(changeAnalysis.dumps, cpuThresholds);
    const seriesAnalysis = annotateSeriesDiagnostics(diagnosticDumps, changeAnalysis.series);
    const smartAnalysisDumps = seriesAnalysis.dumps.map((dump, index, dumps) => ({
        ...dump,
        smartAnalysis: analyzeSnapshotProblems({
            snapshot: dump, snapshotIndex: index, snapshotCount: dumps.length,
            analysisStatus: parserResult.status, parserWarnings: parserResult.warnings,
        }),
    }));
    const parsedDumps = annotateDumpDeltas(smartAnalysisDumps);
    return { ...sourceMetadata, parserResult, parsedDumps, threadSeries: seriesAnalysis.series,
        runnableStackClusters: buildRunnableStackClusters(parsedDumps), blockingPatterns: buildBlockingPatterns(parsedDumps) };
}
