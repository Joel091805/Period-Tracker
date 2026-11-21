/**
 * Phase 1: Core Cycle Prediction Engine
 * Pure, framework-free ES6 module implementing a deterministic 4-stage forecasting pipeline:
 *   Stage 1: Cycle segmentation (bleeding vs. spotting) & median-based outlier guard
 *   Stage 2: Recency-weighted EWMA with cold-start prior blending
 *   Stage 3: Backward luteal anchoring, mid-cycle biomarker overrides & adaptive luteal learning
 *   Stage 4: Variance-adaptive fertile/arrival windows, late-period shift & calendarMap projection
 */

// ---------------------------------------------------------------------------
// Schema Constants & Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS = Object.freeze({
    defaultCycleLength: 28,
    defaultPeriodLength: 5,
    lutealPhaseLength: 14,
    autoLockMinutes: 5,
});

export const BLEEDING_FLOWS = Object.freeze(new Set(['light', 'medium', 'heavy']));
export const VALID_FLOWS = Object.freeze(new Set(['none', 'spotting', 'light', 'medium', 'heavy']));
export const VALID_LH_TESTS = Object.freeze(new Set(['negative', 'positive']));
export const VALID_CERVICAL_MUCUS = Object.freeze(new Set(['dry', 'sticky', 'creamy', 'egg_white']));
export const VALID_SYMPTOMS = Object.freeze(
    new Set([
        'cramps',
        'bloating',
        'headache',
        'fatigue',
        'tender_breasts',
        'acne',
        'backache',
        'nausea',
    ])
);
export const VALID_MOODS = Object.freeze(
    new Set(['calm', 'happy', 'sensitive', 'irritable', 'low_energy'])
);

const EWMA_WEIGHTS = Object.freeze([0.35, 0.25, 0.18, 0.12, 0.06, 0.04]);
const MIN_DEFAULT_CYCLE_LENGTH = 15;
const MAX_DEFAULT_CYCLE_LENGTH = 90;
const MIN_VALID_CYCLE_LENGTH = 21;
const MAX_VALID_CYCLE_LENGTH = 40;
const OUTLIER_MEDIAN_TOLERANCE = 7;
const MIN_LUTEAL_LENGTH = 10;
const MAX_LUTEAL_LENGTH = 17;
const MIN_PERIOD_LENGTH = 1;
const MAX_PERIOD_LENGTH = 12;
const MAX_BLEED_GAP_DAYS = 2; // Allows up to a 1-day pause inside an active bleed (e.g., Day 1 & Day 3)
const PROJECTION_CYCLE_COUNT = 3;
const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Local Noon-Anchored Date Utilities (YYYY-MM-DD)
// ---------------------------------------------------------------------------

const ISO_DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Validates that a string is a real calendar date in YYYY-MM-DD format.
 * Rejects impossible dates such as "2026-02-30".
 */
export function isValidIsoDate(value) {
    if (typeof value !== 'string') return false;
    const match = ISO_DATE_REGEX.exec(value);
    if (!match) return false;

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return false;

    const date = new Date(year, month - 1, day, 12, 0, 0, 0);
    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
    );
}

/**
 * Parses a YYYY-MM-DD string into a local noon-anchored Date object
 * to prevent UTC and DST off-by-one shifts.
 */
export function parseIsoDate(isoDate) {
    if (!isValidIsoDate(isoDate)) {
        throw new RangeError(`Invalid ISO date string: "${isoDate}"`);
    }
    const [year, month, day] = isoDate.split('-').map(Number);
    return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/**
 * Formats a Date object as a local YYYY-MM-DD string.
 */
export function formatIsoDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
        throw new RangeError('Invalid Date object');
    }
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Returns today's local YYYY-MM-DD date string.
 */
export function getTodayIsoDate(now = new Date()) {
    return formatIsoDate(now);
}

/**
 * Adds (or subtracts) an integer number of calendar days to a YYYY-MM-DD string.
 */
export function addDays(isoDate, deltaDays) {
    const date = parseIsoDate(isoDate);
    date.setDate(date.getDate() + Math.trunc(deltaDays));
    return formatIsoDate(date);
}

/**
 * Returns the signed calendar-day difference (endIso - startIso).
 */
export function diffDays(startIso, endIso) {
    const start = parseIsoDate(startIso);
    const end = parseIsoDate(endIso);
    return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
}

/**
 * Lexicographical comparator for valid YYYY-MM-DD strings.
 */
export function compareIsoDates(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
}

/**
 * Creates a clean empty vault state matching the Phase 1/2 schema.
 */
export function createEmptyVaultState(settingsOverrides = {}) {
    return {
        schemaVersion: 1,
        settings: {
            ...DEFAULT_SETTINGS,
            ...settingsOverrides,
        },
        cycles: [],
        dailyLogs: {},
    };
}

// ---------------------------------------------------------------------------
// Internal Math & Helper Utilities
// ---------------------------------------------------------------------------

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function computeMedian(values) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
        return sorted[mid];
    }
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

function computeSampleStdDev(values) {
    if (values.length < 2) return 0;
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance =
        values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
    return Math.sqrt(variance);
}

function makeCycleId(startDate) {
    return `cyc_${startDate.replace(/-/g, '_')}`;
}

function isBleedingFlow(flow) {
    return typeof flow === 'string' && BLEEDING_FLOWS.has(flow);
}

function enumerateDateRange(startIso, endIso) {
    const dates = [];
    const span = diffDays(startIso, endIso);
    for (let offset = 0; offset <= span; offset++) {
        dates.push(addDays(startIso, offset));
    }
    return dates;
}

function rangesOverlapOrAdjacent(aStart, aEnd, bStart, bEnd, maxGapDays = MAX_BLEED_GAP_DAYS) {
    // Two intervals [aStart, aEnd] and [bStart, bEnd] overlap or sit within maxGapDays
    // iff aStart <= bEnd + maxGapDays AND bStart <= aEnd + maxGapDays.
    return (
        diffDays(bEnd, aStart) <= maxGapDays &&
        diffDays(aEnd, bStart) <= maxGapDays
    );
}

// ---------------------------------------------------------------------------
// Stage 1: Cycle Segmentation & Outlier Guard
// ---------------------------------------------------------------------------

/**
 * Extracts merged bleeding blocks from dailyLogs.
 * Only 'light', 'medium', and 'heavy' flows trigger or extend a period.
 * Consecutive bleeding days with gap <= 2 calendar days (up to a 1-day pause)
 * merge into a single period block.
 */
function extractBleedingBlocks(dailyLogs) {
    const bleedingDates = Object.entries(dailyLogs || {})
        .filter(([date, log]) => isValidIsoDate(date) && log && isBleedingFlow(log.flow))
        .map(([date]) => date)
        .sort(compareIsoDates);

    if (bleedingDates.length === 0) return [];

    const blocks = [];
    let current = {
        startDate: bleedingDates[0],
        endDate: bleedingDates[0],
    };

    for (let i = 1; i < bleedingDates.length; i++) {
        const date = bleedingDates[i];
        if (diffDays(current.endDate, date) <= MAX_BLEED_GAP_DAYS) {
            current.endDate = date;
        } else {
            blocks.push(current);
            current = { startDate: date, endDate: date };
        }
    }
    blocks.push(current);
    return blocks;
}

function hasOverlap(aStart, aEnd, bStart, bEnd) {
    return (
        compareIsoDates(aStart, bEnd) <= 0 &&
        compareIsoDates(bStart, aEnd) <= 0
    );
}

/**
 * Rebuilds the canonical sorted `cycles` array from `dailyLogs` while preserving
 * historical cycles that lack daily flow entries and retaining manual ovulation metadata.
 *
 * @param {Record<string, object>} dailyLogs
 * @param {Array<object>} [existingCycles=[]]
 * @param {{ removedFlowDates?: Iterable<string> }} [options={}]
 * @returns {Array<{id: string, startDate: string, endDate: string, confirmedOvulationDate: string|null, isOutlier: boolean}>}
 */
export function rebuildCyclesFromLogs(
    dailyLogs = {},
    existingCycles = [],
    options = {}
) {
    const safeLogs = dailyLogs && typeof dailyLogs === 'object' ? dailyLogs : {};
    const removedFlowDates = new Set(
        options && options.removedFlowDates
            ? Array.from(options.removedFlowDates).filter(isValidIsoDate)
            : []
    );

    const validExisting = (Array.isArray(existingCycles) ? existingCycles : [])
        .filter(
            (c) =>
                c &&
                isValidIsoDate(c.startDate) &&
                (c.endDate == null || isValidIsoDate(c.endDate))
        )
        .map((c) => {
            const endDate =
                c.endDate && compareIsoDates(c.endDate, c.startDate) >= 0
                    ? c.endDate
                    : c.startDate;
            const confirmedOvulationDate = isValidIsoDate(c.confirmedOvulationDate)
                ? c.confirmedOvulationDate
                : null;
            return {
                startDate: c.startDate,
                endDate,
                confirmedOvulationDate,
            };
        });

    const logBlocks = extractBleedingBlocks(safeLogs);
    const mergedCandidates = [];

    // 1. Start with log-derived bleeding blocks, absorbing matching existing cycle metadata
    //    and preserving unlogged historical spans.
    const matchedExistingIndices = new Set();

    for (const block of logBlocks) {
        let startDate = block.startDate;
        let endDate = block.endDate;
        let confirmedOvulationDate = null;

        validExisting.forEach((existing, idx) => {
            if (
                rangesOverlapOrAdjacent(
                    startDate,
                    endDate,
                    existing.startDate,
                    existing.endDate
                )
            ) {
                matchedExistingIndices.add(idx);

                const overlapsExisting = hasOverlap(
                    block.startDate,
                    block.endDate,
                    existing.startDate,
                    existing.endDate
                );

                if (!overlapsExisting) {
                    // Strictly adjacent (gap <= 2 days) to a historical cycle that has no
                    // bleeding logs inside its own range: extend rather than discard it.
                    if (compareIsoDates(existing.startDate, startDate) < 0) {
                        startDate = existing.startDate;
                    }
                    if (compareIsoDates(existing.endDate, endDate) > 0) {
                        endDate = existing.endDate;
                    }
                } else {
                    // Overlapping with an existing cycle: preserve lead/tail days unless
                    // those days have an explicit non-bleeding dailyLog (user trimmed them).
                    if (compareIsoDates(existing.startDate, startDate) < 0) {
                        const extraLeadDates = enumerateDateRange(
                            existing.startDate,
                            addDays(startDate, -1)
                        );
                        if (
                            extraLeadDates.every(
                                (d) => !safeLogs[d] && !removedFlowDates.has(d)
                            )
                        ) {
                            startDate = existing.startDate;
                        }
                    }

                    if (compareIsoDates(existing.endDate, endDate) > 0) {
                        const extraTailDates = enumerateDateRange(
                            addDays(endDate, 1),
                            existing.endDate
                        );
                        if (
                            extraTailDates.every(
                                (d) => !safeLogs[d] && !removedFlowDates.has(d)
                            )
                        ) {
                            endDate = existing.endDate;
                        }
                    }
                }

                if (!confirmedOvulationDate && existing.confirmedOvulationDate) {
                    confirmedOvulationDate = existing.confirmedOvulationDate;
                }
            }
        });

        mergedCandidates.push({ startDate, endDate, confirmedOvulationDate });
    }

    // 2. Preserve historical cycles that have no overlapping/adjacent bleeding logs,
    //    unless every date in the cycle was explicitly marked in `removedFlowDates`.
    validExisting.forEach((existing, idx) => {
        if (matchedExistingIndices.has(idx)) return;
        if (removedFlowDates.size > 0) {
            const dates = enumerateDateRange(existing.startDate, existing.endDate);
            if (dates.every((d) => removedFlowDates.has(d))) {
                return;
            }
        }
        mergedCandidates.push({
            startDate: existing.startDate,
            endDate: existing.endDate,
            confirmedOvulationDate: existing.confirmedOvulationDate,
        });
    });

    if (mergedCandidates.length === 0) return [];

    // 3. Sort chronologically and coalesce any remaining overlapping or <=2-day-gap periods.
    mergedCandidates.sort((a, b) => compareIsoDates(a.startDate, b.startDate));

    const coalesced = [];
    for (const candidate of mergedCandidates) {
        const prev = coalesced[coalesced.length - 1];
        if (
            prev &&
            diffDays(prev.endDate, candidate.startDate) <= MAX_BLEED_GAP_DAYS
        ) {
            if (compareIsoDates(candidate.endDate, prev.endDate) > 0) {
                prev.endDate = candidate.endDate;
            }
            if (!prev.confirmedOvulationDate && candidate.confirmedOvulationDate) {
                prev.confirmedOvulationDate = candidate.confirmedOvulationDate;
            }
        } else {
            coalesced.push({ ...candidate });
        }
    }

    // 4. Attach canonical IDs, derive biomarker-confirmed ovulation, and tag outliers.
    const enriched = attachConfirmedOvulation(coalesced, safeLogs);
    return tagCycleOutliers(enriched);
}

/**
 * Derives `confirmedOvulationDate` per cycle from `dailyLogs` biomarkers:
 *   - First positive `lhTest` in the cycle locks ovulation to `logDate + 1 day`.
 *   - Otherwise, peak (latest) `egg_white` cervical mucus in the cycle sets ovulation to `logDate`.
 *   - Otherwise, preserves an existing manual `confirmedOvulationDate` if within the cycle window.
 */
function attachConfirmedOvulation(cycles, dailyLogs) {
    const sortedLogDates = Object.keys(dailyLogs)
        .filter(isValidIsoDate)
        .sort(compareIsoDates);

    return cycles.map((cycle, index) => {
        const nextCycleStart =
            index + 1 < cycles.length ? cycles[index + 1].startDate : null;

        let firstPositiveLhDate = null;
        let peakEggWhiteDate = null;

        for (const date of sortedLogDates) {
            if (compareIsoDates(date, cycle.startDate) < 0) continue;
            if (nextCycleStart && compareIsoDates(date, nextCycleStart) >= 0) break;

            const log = dailyLogs[date];
            if (!log) continue;

            if (!firstPositiveLhDate && log.lhTest === 'positive') {
                firstPositiveLhDate = date;
            }
            if (log.cervicalMucus === 'egg_white') {
                peakEggWhiteDate = date;
            }
        }

        let confirmedOvulationDate = null;
        if (firstPositiveLhDate) {
            const candidate = addDays(firstPositiveLhDate, 1);
            if (!nextCycleStart || compareIsoDates(candidate, nextCycleStart) < 0) {
                confirmedOvulationDate = candidate;
            }
        } else if (peakEggWhiteDate) {
            confirmedOvulationDate = peakEggWhiteDate;
        } else if (
            cycle.confirmedOvulationDate &&
            compareIsoDates(cycle.confirmedOvulationDate, cycle.startDate) >= 0 &&
            (!nextCycleStart ||
                compareIsoDates(cycle.confirmedOvulationDate, nextCycleStart) < 0)
        ) {
            confirmedOvulationDate = cycle.confirmedOvulationDate;
        }

        return {
            id: makeCycleId(cycle.startDate),
            startDate: cycle.startDate,
            endDate: cycle.endDate,
            confirmedOvulationDate,
            isOutlier: false,
        };
    });
}

/**
 * Computes completed cycle lengths and flags outliers:
 *   L_i < 21, L_i > 40, or |L_i - median| > 7.
 */
function tagCycleOutliers(cycles) {
    if (cycles.length < 2) {
        return cycles.map((c) => ({ ...c, isOutlier: false }));
    }

    const lengths = [];
    for (let i = 0; i < cycles.length - 1; i++) {
        lengths.push(diffDays(cycles[i].startDate, cycles[i + 1].startDate));
    }

    const medianLength = computeMedian(lengths);

    return cycles.map((cycle, index) => {
        if (index === cycles.length - 1) {
            return { ...cycle, isOutlier: false };
        }
        const length = lengths[index];
        const isOutlier =
            length < MIN_VALID_CYCLE_LENGTH ||
            length > MAX_VALID_CYCLE_LENGTH ||
            Math.abs(length - medianLength) > OUTLIER_MEDIAN_TOLERANCE;

        return {
            ...cycle,
            isOutlier,
        };
    });
}

// ---------------------------------------------------------------------------
// Stage 2: EWMA & Period Length Calculation
// ---------------------------------------------------------------------------

function computeCycleBaseline(cycles, settings) {
    const defaultCycleLength = clamp(
        Math.round(Number(settings.defaultCycleLength) || DEFAULT_SETTINGS.defaultCycleLength),
        MIN_DEFAULT_CYCLE_LENGTH,
        MAX_DEFAULT_CYCLE_LENGTH
    );
    const defaultPeriodLength = clamp(
        Math.round(Number(settings.defaultPeriodLength) || DEFAULT_SETTINGS.defaultPeriodLength),
        MIN_PERIOD_LENGTH,
        MAX_PERIOD_LENGTH
    );

    const completedLengths = [];
    const validLengths = [];

    for (let i = 0; i < cycles.length - 1; i++) {
        const length = diffDays(cycles[i].startDate, cycles[i + 1].startDate);
        completedLengths.push(length);
        if (!cycles[i].isOutlier) {
            validLengths.push(length);
        }
    }

    // Fallback to raw completed lengths if every historical cycle was flagged as an outlier.
    const usedFallbackLengths =
        validLengths.length === 0 && completedLengths.length > 0;
    const baselineLengths = usedFallbackLengths ? completedLengths : validLengths;

    // Select up to the 6 most recent valid cycles (newest to oldest).
    const recentNewestFirst = baselineLengths.slice(-EWMA_WEIGHTS.length).reverse();
    const n = recentNewestFirst.length;

    let predictedCycleLength = defaultCycleLength;
    let ewmaRaw = null;

    if (n > 0) {
        let weightedSum = 0;
        let weightTotal = 0;
        for (let i = 0; i < n; i++) {
            weightedSum += EWMA_WEIGHTS[i] * recentNewestFirst[i];
            weightTotal += EWMA_WEIGHTS[i];
        }
        ewmaRaw = weightedSum / weightTotal;

        if (n < 3) {
            const alpha = (3 - n) / 4;
            predictedCycleLength = Math.max(
                1,
                Math.round(alpha * defaultCycleLength + (1 - alpha) * ewmaRaw)
            );
        } else {
            predictedCycleLength = Math.max(1, Math.round(ewmaRaw));
        }
    }

    // Average period length over up to the last 6 cycles, clamped to [1, 12].
    let averagePeriodLength = defaultPeriodLength;
    if (cycles.length > 0) {
        const recentCycles = cycles.slice(-6);
        const durations = recentCycles.map(
            (c) => diffDays(c.startDate, c.endDate) + 1
        );
        const meanDuration =
            durations.reduce((sum, d) => sum + d, 0) / durations.length;
        averagePeriodLength = clamp(
            Math.round(meanDuration),
            MIN_PERIOD_LENGTH,
            MAX_PERIOD_LENGTH
        );
    }

    const cycleLengthStdDev = computeSampleStdDev(baselineLengths);

    return {
        predictedCycleLength,
        ewmaRaw,
        averagePeriodLength,
        cycleLengthStdDev,
        validCycleCount: validLengths.length,
        completedCycleCount: completedLengths.length,
        usedFallbackLengths,
        baselineLengths,
    };
}

// ---------------------------------------------------------------------------
// Stage 3: Adaptive Luteal Learning & Biomarker Overrides
// ---------------------------------------------------------------------------

function computeAdaptiveLutealLength(cycles, settings) {
    const defaultLuteal = clamp(
        Math.round(Number(settings.lutealPhaseLength) || DEFAULT_SETTINGS.lutealPhaseLength),
        MIN_LUTEAL_LENGTH,
        MAX_LUTEAL_LENGTH
    );

    const observedLutealLengths = [];
    for (let i = 0; i < cycles.length - 1; i++) {
        const cycle = cycles[i];
        if (!cycle.confirmedOvulationDate) continue;
        const observed = diffDays(
            cycle.confirmedOvulationDate,
            cycles[i + 1].startDate
        );
        if (observed >= MIN_LUTEAL_LENGTH && observed <= MAX_LUTEAL_LENGTH) {
            observedLutealLengths.push(observed);
        }
    }

    if (observedLutealLengths.length === 0) {
        return {
            lutealPhaseLength: defaultLuteal,
            observedLutealCount: 0,
            isAdaptiveLuteal: false,
        };
    }

    const meanLuteal =
        observedLutealLengths.reduce((sum, v) => sum + v, 0) /
        observedLutealLengths.length;

    return {
        lutealPhaseLength: clamp(
            Math.round(meanLuteal),
            MIN_LUTEAL_LENGTH,
            MAX_LUTEAL_LENGTH
        ),
        observedLutealCount: observedLutealLengths.length,
        isAdaptiveLuteal: true,
    };
}

// ---------------------------------------------------------------------------
// Stage 4: Windows, Late State & Calendar Projection
// ---------------------------------------------------------------------------

function computeFertileWindow(ovulationDate, stdDev) {
    const isIrregular = stdDev > 2.0;
    const preOvulationDays = isIrregular
        ? 5 + Math.min(4, Math.round(stdDev))
        : 5;

    return {
        start: addDays(ovulationDate, -preOvulationDays),
        end: addDays(ovulationDate, 1),
        isWidenedForIrregularity: isIrregular,
    };
}

function getOrCreateCalendarEntry(calendarMap, isoDate) {
    if (!calendarMap[isoDate]) {
        calendarMap[isoDate] = {
            date: isoDate,
            isLoggedPeriod: false,
            isPredictedPeriod: false,
            isFertileWindow: false,
            isPredictedOvulation: false,
            isConfirmedOvulation: false,
            isSpotting: false,
            hasLog: false,
            cycleId: null,
            cycleDay: null,
            projectionIndex: null,
            flow: null,
            lhTest: null,
            cervicalMucus: null,
            mood: null,
            symptomCount: 0,
        };
    }
    return calendarMap[isoDate];
}

function buildCalendarMap({
    cycles,
    dailyLogs,
    activeOvulationDate,
    isOvulationConfirmed,
    activeFertileWindow,
    predictedNextPeriodStart,
    predictedCycleLength,
    averagePeriodLength,
    lutealPhaseLength,
    cycleLengthStdDev,
}) {
    const calendarMap = {};

    // 1. Mark daily log flags & spotting.
    for (const [date, log] of Object.entries(dailyLogs || {})) {
        if (!isValidIsoDate(date) || !log || typeof log !== 'object') continue;
        const entry = getOrCreateCalendarEntry(calendarMap, date);
        entry.hasLog = true;
        entry.flow = VALID_FLOWS.has(log.flow) ? log.flow : null;
        entry.isSpotting = log.flow === 'spotting';
        entry.lhTest = VALID_LH_TESTS.has(log.lhTest) ? log.lhTest : null;
        entry.cervicalMucus = VALID_CERVICAL_MUCUS.has(log.cervicalMucus)
            ? log.cervicalMucus
            : null;
        entry.mood = VALID_MOODS.has(log.mood) ? log.mood : null;
        entry.symptomCount = Array.isArray(log.symptoms) ? log.symptoms.length : 0;
    }

    // 2. Mark historical & active logged periods and confirmed ovulation dates.
    for (const cycle of cycles) {
        const periodDates = enumerateDateRange(cycle.startDate, cycle.endDate);
        periodDates.forEach((date, offset) => {
            const entry = getOrCreateCalendarEntry(calendarMap, date);
            entry.isLoggedPeriod = true;
            entry.cycleId = cycle.id;
            entry.cycleDay = offset + 1;
        });

        if (cycle.confirmedOvulationDate) {
            const ovEntry = getOrCreateCalendarEntry(
                calendarMap,
                cycle.confirmedOvulationDate
            );
            ovEntry.isConfirmedOvulation = true;
            ovEntry.cycleId = cycle.id;
        }
    }

    // 3. Mark active cycle's fertile window & predicted/confirmed ovulation.
    if (activeFertileWindow) {
        for (const date of enumerateDateRange(
            activeFertileWindow.start,
            activeFertileWindow.end
        )) {
            const entry = getOrCreateCalendarEntry(calendarMap, date);
            entry.isFertileWindow = true;
        }
    }

    if (activeOvulationDate) {
        const entry = getOrCreateCalendarEntry(calendarMap, activeOvulationDate);
        if (isOvulationConfirmed) {
            entry.isConfirmedOvulation = true;
        } else {
            entry.isPredictedOvulation = true;
        }
    }

    // 4. Project the next 3 future cycles (periods, ovulations, fertile windows).
    const projectedCycles = [];
    if (predictedNextPeriodStart) {
        for (let step = 0; step < PROJECTION_CYCLE_COUNT; step++) {
            const projStart = addDays(
                predictedNextPeriodStart,
                step * predictedCycleLength
            );
            const projEnd = addDays(projStart, averagePeriodLength - 1);
            const nextProjStart = addDays(projStart, predictedCycleLength);
            const projOvulation = addDays(nextProjStart, -lutealPhaseLength);
            const projFertile = computeFertileWindow(
                projOvulation,
                cycleLengthStdDev
            );

            projectedCycles.push({
                projectionIndex: step + 1,
                periodStart: projStart,
                periodEnd: projEnd,
                ovulationDate: projOvulation,
                fertileWindow: projFertile,
            });

            for (const date of enumerateDateRange(projStart, projEnd)) {
                const entry = getOrCreateCalendarEntry(calendarMap, date);
                entry.isPredictedPeriod = true;
                if (entry.projectionIndex === null) {
                    entry.projectionIndex = step + 1;
                }
            }

            for (const date of enumerateDateRange(
                projFertile.start,
                projFertile.end
            )) {
                const entry = getOrCreateCalendarEntry(calendarMap, date);
                entry.isFertileWindow = true;
            }

            const ovEntry = getOrCreateCalendarEntry(calendarMap, projOvulation);
            ovEntry.isPredictedOvulation = true;
        }
    }

    return { calendarMap, projectedCycles };
}

function determineCurrentPhase({
    today,
    activeCycle,
    isLate,
    predictedOvulationDate,
    fertileWindow,
}) {
    if (!activeCycle) return 'unknown';
    if (
        compareIsoDates(today, activeCycle.startDate) >= 0 &&
        compareIsoDates(today, activeCycle.endDate) <= 0
    ) {
        return 'menstrual';
    }
    if (isLate) return 'late';
    if (predictedOvulationDate && today === predictedOvulationDate) {
        return 'ovulation';
    }
    if (
        fertileWindow &&
        compareIsoDates(today, fertileWindow.start) >= 0 &&
        compareIsoDates(today, fertileWindow.end) <= 0
    ) {
        return 'fertile';
    }
    if (
        predictedOvulationDate &&
        compareIsoDates(today, predictedOvulationDate) > 0
    ) {
        return 'luteal';
    }
    if (compareIsoDates(today, activeCycle.startDate) > 0) {
        return 'follicular';
    }
    return 'unknown';
}

// ---------------------------------------------------------------------------
// Public Entry Point
// ---------------------------------------------------------------------------

/**
 * Executes the full 4-stage deterministic prediction pipeline on a decrypted vault state.
 * Pure function: does not mutate `vaultState`.
 *
 * @param {object} vaultState - Decrypted vault object `{ settings, cycles, dailyLogs }`.
 * @param {string} [todayIso] - Reference date in YYYY-MM-DD (defaults to local today).
 * @returns {object} Forecast summary, rebuilt cycles, and pre-computed `calendarMap`.
 */
export function runPredictionEngine(vaultState = {}, todayIso = getTodayIsoDate()) {
    const today = isValidIsoDate(todayIso) ? todayIso : getTodayIsoDate();
    const settings = {
        ...DEFAULT_SETTINGS,
        ...(vaultState && typeof vaultState.settings === 'object'
            ? vaultState.settings
            : {}),
    };
    const dailyLogs =
        vaultState && typeof vaultState.dailyLogs === 'object' && vaultState.dailyLogs
            ? vaultState.dailyLogs
            : {};
    const existingCycles = Array.isArray(vaultState?.cycles)
        ? vaultState.cycles
        : [];

    // Stage 1: Segmentation & Outlier Guard
    const cycles = rebuildCyclesFromLogs(dailyLogs, existingCycles);

    // Stage 2: EWMA & Period Length
    const baseline = computeCycleBaseline(cycles, settings);

    // Stage 3: Adaptive Luteal Learning
    const luteal = computeAdaptiveLutealLength(cycles, settings);

    // Empty-state handling (no logged or imported periods yet)
    if (cycles.length === 0) {
        const { calendarMap } = buildCalendarMap({
            cycles: [],
            dailyLogs,
            activeOvulationDate: null,
            isOvulationConfirmed: false,
            activeFertileWindow: null,
            predictedNextPeriodStart: null,
            predictedCycleLength: baseline.predictedCycleLength,
            averagePeriodLength: baseline.averagePeriodLength,
            lutealPhaseLength: luteal.lutealPhaseLength,
            cycleLengthStdDev: baseline.cycleLengthStdDev,
        });

        return {
            hasData: false,
            today,
            cycles: [],
            activeCycle: null,
            currentCycleDay: null,
            currentPhase: 'unknown',
            predictedCycleLength: baseline.predictedCycleLength,
            averagePeriodLength: baseline.averagePeriodLength,
            lutealPhaseLength: luteal.lutealPhaseLength,
            isAdaptiveLuteal: false,
            cycleLengthStdDev: 0,
            isIrregular: false,
            predictedOvulationDate: null,
            isOvulationConfirmed: false,
            fertileWindow: null,
            expectedNextPeriodStart: null,
            predictedNextPeriodStart: null,
            periodArrivalWindow: null,
            daysUntilNextPeriod: null,
            isLate: false,
            daysLate: 0,
            projectedCycles: [],
            calendarMap,
            diagnostics: {
                ewmaRaw: null,
                validCycleCount: 0,
                completedCycleCount: 0,
                usedFallbackLengths: false,
                observedLutealCount: 0,
            },
        };
    }

    // Stage 3 (continued): Active cycle anchoring & biomarker override
    const activeCycle = cycles[cycles.length - 1];
    let baseNextPeriodStart;
    let predictedOvulationDate;
    let isOvulationConfirmed = false;

    if (activeCycle.confirmedOvulationDate) {
        predictedOvulationDate = activeCycle.confirmedOvulationDate;
        baseNextPeriodStart = addDays(
            activeCycle.confirmedOvulationDate,
            luteal.lutealPhaseLength
        );
        isOvulationConfirmed = true;
    } else {
        baseNextPeriodStart = addDays(
            activeCycle.startDate,
            baseline.predictedCycleLength
        );
        predictedOvulationDate = addDays(
            baseNextPeriodStart,
            -luteal.lutealPhaseLength
        );
    }

    // Stage 4: Late-period handling, variance-adaptive windows & calendar projection
    const isLate = compareIsoDates(today, baseNextPeriodStart) > 0;
    const daysLate = isLate ? diffDays(baseNextPeriodStart, today) : 0;
    const predictedNextPeriodStart = isLate
        ? addDays(today, 1)
        : baseNextPeriodStart;

    const arrivalMargin = Math.max(
        1,
        Math.min(3, Math.round(baseline.cycleLengthStdDev))
    );
    const periodArrivalWindow = {
        earliest: addDays(predictedNextPeriodStart, -arrivalMargin),
        latest: addDays(predictedNextPeriodStart, arrivalMargin),
    };

    const fertileWindow = computeFertileWindow(
        predictedOvulationDate,
        baseline.cycleLengthStdDev
    );

    const currentCycleDay =
        compareIsoDates(today, activeCycle.startDate) >= 0
            ? diffDays(activeCycle.startDate, today) + 1
            : null;

    const daysUntilNextPeriod = diffDays(today, predictedNextPeriodStart);
    const currentPhase = determineCurrentPhase({
        today,
        activeCycle,
        isLate,
        predictedOvulationDate,
        fertileWindow,
    });

    const { calendarMap, projectedCycles } = buildCalendarMap({
        cycles,
        dailyLogs,
        activeOvulationDate: predictedOvulationDate,
        isOvulationConfirmed,
        activeFertileWindow: fertileWindow,
        predictedNextPeriodStart,
        predictedCycleLength: baseline.predictedCycleLength,
        averagePeriodLength: baseline.averagePeriodLength,
        lutealPhaseLength: luteal.lutealPhaseLength,
        cycleLengthStdDev: baseline.cycleLengthStdDev,
    });

    return {
        hasData: true,
        today,
        cycles,
        activeCycle,
        currentCycleDay,
        currentPhase,
        predictedCycleLength: baseline.predictedCycleLength,
        averagePeriodLength: baseline.averagePeriodLength,
        lutealPhaseLength: luteal.lutealPhaseLength,
        isAdaptiveLuteal: luteal.isAdaptiveLuteal,
        cycleLengthStdDev: Number(baseline.cycleLengthStdDev.toFixed(2)),
        isIrregular: baseline.cycleLengthStdDev > 2.0,
        predictedOvulationDate,
        isOvulationConfirmed,
        fertileWindow,
        expectedNextPeriodStart: baseNextPeriodStart,
        predictedNextPeriodStart,
        periodArrivalWindow,
        daysUntilNextPeriod,
        isLate,
        daysLate,
        projectedCycles,
        calendarMap,
        diagnostics: {
            ewmaRaw:
                baseline.ewmaRaw !== null
                    ? Number(baseline.ewmaRaw.toFixed(2))
                    : null,
            validCycleCount: baseline.validCycleCount,
            completedCycleCount: baseline.completedCycleCount,
            usedFallbackLengths: baseline.usedFallbackLengths,
            observedLutealCount: luteal.observedLutealCount,
        },
    };
}
