/**
 * Phase 1: Flo Historical Data Importer
 * Pure ES6 module that defensively extracts, normalizes, and merges historical
 * Flo JSON data exports into the local vault schema without overwriting user notes.
 */

import {
    VALID_FLOWS,
    VALID_LH_TESTS,
    VALID_CERVICAL_MUCUS,
    VALID_SYMPTOMS,
    VALID_MOODS,
    isValidIsoDate,
    formatIsoDate,
    addDays,
    compareIsoDates,
    createEmptyVaultState,
    rebuildCyclesFromLogs,
} from './predictionEngine.js';

// ---------------------------------------------------------------------------
// Normalization Lookup Tables
// ---------------------------------------------------------------------------

const FLOW_MAP = Object.freeze({
    none: 'none',
    no: 'none',
    no_flow: 'none',
    noflow: 'none',
    0: 'none',

    spotting: 'spotting',
    spot: 'spotting',
    spotting_bleeding: 'spotting',

    light: 'light',
    low: 'light',
    light_flow: 'light',
    light_bleeding: 'light',
    1: 'light',

    medium: 'medium',
    moderate: 'medium',
    normal: 'medium',
    medium_flow: 'medium',
    medium_bleeding: 'medium',
    2: 'medium',

    heavy: 'heavy',
    high: 'heavy',
    super_heavy: 'heavy',
    heavy_flow: 'heavy',
    heavy_bleeding: 'heavy',
    3: 'heavy',
});

const LH_TEST_MAP = Object.freeze({
    positive: 'positive',
    lh_positive: 'positive',
    ovulation_positive: 'positive',
    peak: 'positive',
    high: 'positive',
    pos: 'positive',
    '+': 'positive',

    negative: 'negative',
    lh_negative: 'negative',
    ovulation_negative: 'negative',
    low: 'negative',
    neg: 'negative',
    '-': 'negative',
});

const CERVICAL_MUCUS_MAP = Object.freeze({
    dry: 'dry',
    none: 'dry',
    no_discharge: 'dry',

    sticky: 'sticky',
    tacky: 'sticky',

    creamy: 'creamy',
    lotiony: 'creamy',
    milky: 'creamy',

    egg_white: 'egg_white',
    eggwhite: 'egg_white',
    fertile: 'egg_white',
    watery: 'egg_white',
    stretchy: 'egg_white',
    slippery: 'egg_white',
});

const SYMPTOM_MAP = Object.freeze({
    cramps: 'cramps',
    abdominal_cramps: 'cramps',
    menstrual_cramps: 'cramps',
    pelvic_pain: 'cramps',
    stomach_cramps: 'cramps',

    bloating: 'bloating',
    bloated: 'bloating',

    headache: 'headache',
    headaches: 'headache',
    migraine: 'headache',

    fatigue: 'fatigue',
    tired: 'fatigue',
    tiredness: 'fatigue',
    exhausted: 'fatigue',
    exhaustion: 'fatigue',
    low_energy: 'fatigue',

    tender_breasts: 'tender_breasts',
    breast_tenderness: 'tender_breasts',
    sore_breasts: 'tender_breasts',
    breasts_tender: 'tender_breasts',
    sensitive_breasts: 'tender_breasts',

    acne: 'acne',
    pimples: 'acne',
    breakout: 'acne',
    breakouts: 'acne',
    skin_breakout: 'acne',

    backache: 'backache',
    back_ache: 'backache',
    back_pain: 'backache',
    lower_back_pain: 'backache',

    nausea: 'nausea',
    nauseous: 'nausea',
    queasy: 'nausea',
});

const MOOD_MAP = Object.freeze({
    calm: 'calm',
    relaxed: 'calm',
    peaceful: 'calm',
    fine: 'calm',
    neutral: 'calm',

    happy: 'happy',
    energetic: 'happy',
    excited: 'happy',
    cheerful: 'happy',
    confident: 'happy',
    frisky: 'happy',

    sensitive: 'sensitive',
    emotional: 'sensitive',
    mood_swings: 'sensitive',
    anxious: 'sensitive',
    self_critical: 'sensitive',
    overwhelmed: 'sensitive',

    irritable: 'irritable',
    irritated: 'irritable',
    angry: 'irritable',
    frustrated: 'irritable',
    annoyed: 'irritable',

    low_energy: 'low_energy',
    sad: 'low_energy',
    depressed: 'low_energy',
    apathetic: 'low_energy',
    lethargic: 'low_energy',
    unmotivated: 'low_energy',
});

const CONTAINER_KEYS = [
    'operationalData',
    'operational_data',
    'data',
    'user_data',
    'userData',
    'export',
];

const CYCLE_ARRAY_KEYS = [
    'cycles',
    'periods',
    'menstrual_cycles',
    'menstrualCycles',
    'period_dates',
    'periodDates',
];

const LOG_ARRAY_KEYS = [
    'daily_logs',
    'dailyLogs',
    'symptoms',
    'events',
    'logs',
    'point_events',
    'pointEvents',
    'calendar_events',
    'calendarEvents',
];

// ---------------------------------------------------------------------------
// Token & Date Normalization Helpers
// ---------------------------------------------------------------------------

function normalizeToken(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .trim()
        .toLowerCase()
        .replace(/[\s\-/]+/g, '_')
        .replace(/[^a-z0-9_+-]/g, '');
}

/**
 * Converts various Flo timestamp/date representations into local YYYY-MM-DD.
 * Returns null if the input cannot be parsed into a valid calendar date.
 */
export function normalizeFloDate(raw) {
    if (raw === null || raw === undefined || raw === '') return null;

    if (typeof raw === 'number' && Number.isFinite(raw)) {
        // Treat values < 1e12 as Unix seconds, otherwise milliseconds.
        const ms = Math.abs(raw) < 1e12 ? raw * 1000 : raw;
        const date = new Date(ms);
        if (Number.isNaN(date.getTime())) return null;
        return formatIsoDate(date);
    }

    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;

    // 1. Direct YYYY-MM-DD or ISO-8601 prefix (YYYY-MM-DDTHH:mm:ss...)
    //    Extract the calendar date prefix directly to avoid UTC midnight shift.
    const isoPrefix = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(trimmed);
    if (isoPrefix) {
        const candidate = `${isoPrefix[1]}-${isoPrefix[2]}-${isoPrefix[3]}`;
        return isValidIsoDate(candidate) ? candidate : null;
    }

    // 2. Slash-delimited YYYY/MM/DD
    const ymdSlash = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:$|\s)/.exec(trimmed);
    if (ymdSlash) {
        const candidate = `${ymdSlash[1]}-${ymdSlash[2].padStart(2, '0')}-${ymdSlash[3].padStart(2, '0')}`;
        return isValidIsoDate(candidate) ? candidate : null;
    }

    // 3. Slash-delimited MM/DD/YYYY (US) or unambiguous DD/MM/YYYY (EU, when first > 12)
    const slashDate = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
    if (slashDate) {
        const first = Number(slashDate[1]);
        const second = Number(slashDate[2]);
        const year = slashDate[3];
        const candidate =
            first > 12 && second <= 12
                ? `${year}-${String(second).padStart(2, '0')}-${String(first).padStart(2, '0')}`
                : `${year}-${String(first).padStart(2, '0')}-${String(second).padStart(2, '0')}`;
        return isValidIsoDate(candidate) ? candidate : null;
    }

    // 4. Dot-delimited DD.MM.YYYY (common in European exports)
    const dotDate = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(trimmed);
    if (dotDate) {
        const candidate = `${dotDate[3]}-${dotDate[2].padStart(2, '0')}-${dotDate[1].padStart(2, '0')}`;
        return isValidIsoDate(candidate) ? candidate : null;
    }

    // 4. Numeric string timestamp
    if (/^\d{9,13}$/.test(trimmed)) {
        return normalizeFloDate(Number(trimmed));
    }

    // 5. Last resort: Date.parse for RFC-style strings (e.g., "Oct 14, 2026")
    const parsed = new Date(trimmed);
    if (!Number.isNaN(parsed.getTime())) {
        return formatIsoDate(parsed);
    }

    return null;
}

function normalizeFlow(raw) {
    const token = normalizeToken(raw);
    if (!token) return null;
    const mapped = FLOW_MAP[token];
    return mapped && VALID_FLOWS.has(mapped) ? mapped : null;
}

function normalizeLhTest(raw) {
    if (typeof raw === 'boolean') return raw ? 'positive' : 'negative';
    const token = normalizeToken(raw);
    if (!token) return null;
    const mapped = LH_TEST_MAP[token];
    return mapped && VALID_LH_TESTS.has(mapped) ? mapped : null;
}

function normalizeCervicalMucus(raw) {
    const token = normalizeToken(raw);
    if (!token) return null;
    const mapped = CERVICAL_MUCUS_MAP[token];
    return mapped && VALID_CERVICAL_MUCUS.has(mapped) ? mapped : null;
}

function normalizeSymptom(raw) {
    const token = normalizeToken(raw);
    if (!token) return null;
    const mapped = SYMPTOM_MAP[token];
    return mapped && VALID_SYMPTOMS.has(mapped) ? mapped : null;
}

function normalizeMood(raw) {
    const token = normalizeToken(raw);
    if (!token) return null;
    const mapped = MOOD_MAP[token];
    return mapped && VALID_MOODS.has(mapped) ? mapped : null;
}

function normalizeBbt(raw) {
    if (raw === null || raw === undefined || raw === '') return null;
    const num = Number(raw);
    if (!Number.isFinite(num)) return null;
    // Accept plausible human BBT in Celsius (34-42) or Fahrenheit (93-108).
    const isValidC = num >= 34.0 && num <= 42.0;
    const isValidF = num >= 93.0 && num <= 108.0;
    if (!isValidC && !isValidF) return null;
    return Number(num.toFixed(2));
}

function createBlankDailyLog() {
    return {
        flow: 'none',
        lhTest: null,
        bbt: null,
        cervicalMucus: null,
        symptoms: [],
        mood: null,
        note: '',
    };
}

// ---------------------------------------------------------------------------
// Defensive Container Extraction
// ---------------------------------------------------------------------------

function collectSearchContainers(root) {
    const containers = [];
    const seen = new Set();

    function visit(obj, depth = 0) {
        if (!obj || typeof obj !== 'object' || Array.isArray(obj) || seen.has(obj)) {
            return;
        }
        seen.add(obj);
        containers.push(obj);
        if (depth >= 2) return;

        for (const key of CONTAINER_KEYS) {
            if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
                visit(obj[key], depth + 1);
            }
        }
    }

    visit(root);
    return containers;
}

function extractRecordsFromContainers(containers, candidateKeys) {
    const records = [];
    for (const container of containers) {
        for (const key of candidateKeys) {
            const value = container[key];
            if (Array.isArray(value)) {
                records.push(...value);
            } else if (
                value &&
                typeof value === 'object' &&
                !Array.isArray(value) &&
                candidateKeys === LOG_ARRAY_KEYS
            ) {
                // Support date-keyed dailyLogs objects (e.g. { "2026-10-14": { ... } })
                for (const [dateKey, entry] of Object.entries(value)) {
                    if (isValidIsoDate(dateKey) && entry && typeof entry === 'object') {
                        records.push({ date: dateKey, ...entry });
                    }
                }
            }
        }
    }
    return records;
}

// ---------------------------------------------------------------------------
// Record Parsers
// ---------------------------------------------------------------------------

function parseCycleRecord(record) {
    if (!record || typeof record !== 'object') return null;

    const rawStart =
        record.period_start_date ??
        record.periodStartDate ??
        record.start_date ??
        record.startDate ??
        record.period_start ??
        record.periodStart ??
        record.start ??
        record.date;

    const rawEnd =
        record.period_end_date ??
        record.periodEndDate ??
        record.end_date ??
        record.endDate ??
        record.period_end ??
        record.periodEnd ??
        record.end;

    const startDate = normalizeFloDate(rawStart);
    if (!startDate) return null;

    let endDate = normalizeFloDate(rawEnd);
    if (!endDate || compareIsoDates(endDate, startDate) < 0) {
        // Fallback: if Flo provides period_length / periodLength, derive endDate.
        const periodLength = Number(record.period_length ?? record.periodLength);
        if (Number.isFinite(periodLength) && periodLength >= 1 && periodLength <= 15) {
            endDate = addDays(startDate, Math.round(periodLength) - 1);
        } else {
            endDate = startDate;
        }
    }

    const confirmedOvulationDate = normalizeFloDate(
        record.confirmedOvulationDate ??
            record.confirmed_ovulation_date ??
            record.ovulation_date ??
            record.ovulationDate
    );

    return {
        startDate,
        endDate,
        confirmedOvulationDate,
    };
}

/**
 * Applies a single Flo daily log / point event record onto an accumulator map
 * keyed by YYYY-MM-DD. Supports both structured daily-log objects and flat
 * Flo `point_events` (`{ date, category, subcategory, value }`).
 */
function applyLogRecordToAccumulator(record, logAccumulator) {
    if (!record || typeof record !== 'object') return false;

    const date = normalizeFloDate(
        record.date ??
            record.day ??
            record.timestamp ??
            record.created_at ??
            record.logged_at ??
            record.event_date
    );
    if (!date) return false;

    if (!logAccumulator.has(date)) {
        logAccumulator.set(date, createBlankDailyLog());
    }
    const target = logAccumulator.get(date);
    let touched = false;

    // A. Structured fields
    const rawFlow =
        record.flow ??
        record.menstrual_flow ??
        record.bleeding ??
        record.period_flow ??
        record.intensity;
    const flow = normalizeFlow(rawFlow);
    if (flow) {
        if (flow !== 'none' || target.flow === 'none') {
            target.flow = flow;
        }
        touched = true;
    }

    const rawLh =
        record.lhTest ??
        record.lh_test ??
        record.ovulation_test ??
        record.ovulationTest ??
        record.lh;
    const lhTest = normalizeLhTest(rawLh);
    if (lhTest) {
        // Positive takes precedence if multiple tests are logged on the same day.
        if (target.lhTest !== 'positive') {
            target.lhTest = lhTest;
        }
        touched = true;
    }

    const rawBbt =
        record.bbt ??
        record.basal_body_temperature ??
        record.temperature ??
        record.temp;
    const bbt = normalizeBbt(rawBbt);
    if (bbt !== null) {
        target.bbt = bbt;
        touched = true;
    }

    const rawMucus =
        record.cervicalMucus ??
        record.cervical_mucus ??
        record.discharge ??
        record.vaginal_discharge;
    const mucus = normalizeCervicalMucus(rawMucus);
    if (mucus) {
        target.cervicalMucus = mucus;
        touched = true;
    }

    const rawMood = record.mood ?? record.moods;
    if (Array.isArray(rawMood)) {
        for (const m of rawMood) {
            const mapped = normalizeMood(m);
            if (mapped) {
                target.mood = mapped;
                touched = true;
                break;
            }
        }
    } else {
        const mappedMood = normalizeMood(rawMood);
        if (mappedMood) {
            target.mood = mappedMood;
            touched = true;
        }
    }

    const rawSymptoms = record.symptoms ?? record.symptom ?? record.tags;
    if (Array.isArray(rawSymptoms)) {
        for (const s of rawSymptoms) {
            const label = typeof s === 'object' && s !== null ? s.name ?? s.value ?? s.type : s;
            const mapped = normalizeSymptom(label);
            if (mapped && !target.symptoms.includes(mapped)) {
                target.symptoms.push(mapped);
                touched = true;
            }
        }
    } else if (typeof rawSymptoms === 'string') {
        for (const part of rawSymptoms.split(',')) {
            const mapped = normalizeSymptom(part);
            if (mapped && !target.symptoms.includes(mapped)) {
                target.symptoms.push(mapped);
                touched = true;
            }
        }
    }

    const rawNote = record.note ?? record.notes ?? record.comment;
    if (typeof rawNote === 'string' && rawNote.trim().length > 0) {
        const trimmedNote = rawNote.trim();
        if (!target.note) {
            target.note = trimmedNote;
        } else if (!target.note.includes(trimmedNote)) {
            target.note = `${target.note}\n${trimmedNote}`;
        }
        touched = true;
    }

    // B. Flat Flo point-event format: { category, subcategory, value }
    const category = normalizeToken(record.category ?? record.type ?? record.event_type);
    const subValue = record.subcategory ?? record.value ?? record.name ?? record.label;

    if (category && subValue !== undefined && subValue !== null) {
        if (category.includes('flow') || category.includes('bleed') || category.includes('period')) {
            const mappedFlow = normalizeFlow(subValue);
            if (mappedFlow) {
                if (mappedFlow !== 'none' || target.flow === 'none') {
                    target.flow = mappedFlow;
                }
                touched = true;
            }
        } else if (category.includes('ovulation') || category === 'lh' || category.includes('lh_test')) {
            const mappedLh = normalizeLhTest(subValue);
            if (mappedLh) {
                if (target.lhTest !== 'positive') {
                    target.lhTest = mappedLh;
                }
                touched = true;
            }
        } else if (category.includes('mucus') || category.includes('discharge')) {
            const mappedMucus = normalizeCervicalMucus(subValue);
            if (mappedMucus) {
                target.cervicalMucus = mappedMucus;
                touched = true;
            }
        } else if (category.includes('temp') || category === 'bbt') {
            const mappedBbt = normalizeBbt(subValue);
            if (mappedBbt !== null) {
                target.bbt = mappedBbt;
                touched = true;
            }
        } else if (category.includes('mood')) {
            const mappedMood = normalizeMood(subValue);
            if (mappedMood) {
                target.mood = mappedMood;
                touched = true;
            }
        } else if (category.includes('symptom') || category.includes('pain')) {
            const mappedSymptom = normalizeSymptom(subValue);
            if (mappedSymptom && !target.symptoms.includes(mappedSymptom)) {
                target.symptoms.push(mappedSymptom);
                touched = true;
            }
        } else if (category.includes('note')) {
            const noteText = String(subValue).trim();
            if (noteText) {
                if (!target.note) {
                    target.note = noteText;
                } else if (!target.note.includes(noteText)) {
                    target.note = `${target.note}\n${noteText}`;
                }
                touched = true;
            }
        }
    }

    if (!touched) {
        // Avoid leaving empty ghost logs for unrecognized Flo event categories.
        if (
            target.flow === 'none' &&
            target.lhTest === null &&
            target.bbt === null &&
            target.cervicalMucus === null &&
            target.symptoms.length === 0 &&
            target.mood === null &&
            target.note === ''
        ) {
            logAccumulator.delete(date);
        }
    }

    return touched;
}

// ---------------------------------------------------------------------------
// Non-Destructive Vault Merging
// ---------------------------------------------------------------------------

function cloneVaultState(existingVaultState) {
    const base = createEmptyVaultState();
    if (!existingVaultState || typeof existingVaultState !== 'object') {
        return base;
    }

    return {
        schemaVersion: existingVaultState.schemaVersion ?? base.schemaVersion,
        settings: {
            ...base.settings,
            ...(existingVaultState.settings || {}),
        },
        cycles: Array.isArray(existingVaultState.cycles)
            ? existingVaultState.cycles.map((c) => ({ ...c }))
            : [],
        dailyLogs: Object.fromEntries(
            Object.entries(existingVaultState.dailyLogs || {}).map(([date, log]) => [
                date,
                {
                    ...createBlankDailyLog(),
                    ...log,
                    symptoms: Array.isArray(log?.symptoms) ? [...log.symptoms] : [],
                },
            ])
        ),
    };
}

function mergeDailyLogEntry(existingLog, importedLog) {
    if (!existingLog) {
        return {
            ...createBlankDailyLog(),
            ...importedLog,
            symptoms: [...importedLog.symptoms],
        };
    }

    const mergedSymptoms = Array.from(
        new Set([...(existingLog.symptoms || []), ...(importedLog.symptoms || [])])
    ).filter((s) => VALID_SYMPTOMS.has(s));

    // Preserve existing user values and never overwrite existing user notes.
    const existingFlow = VALID_FLOWS.has(existingLog.flow) ? existingLog.flow : 'none';
    const flow =
        existingFlow !== 'none'
            ? existingFlow
            : VALID_FLOWS.has(importedLog.flow)
              ? importedLog.flow
              : 'none';

    const existingNote = typeof existingLog.note === 'string' ? existingLog.note : '';
    const importedNote = typeof importedLog.note === 'string' ? importedLog.note : '';

    return {
        flow,
        lhTest: existingLog.lhTest ?? importedLog.lhTest ?? null,
        bbt: existingLog.bbt ?? importedLog.bbt ?? null,
        cervicalMucus: existingLog.cervicalMucus ?? importedLog.cervicalMucus ?? null,
        symptoms: mergedSymptoms,
        mood: existingLog.mood ?? importedLog.mood ?? null,
        note: existingNote.trim().length > 0 ? existingNote : importedNote,
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parses a raw Flo JSON export (string or object), normalizes all cycles and
 * daily logs, merges non-destructively into `existingVaultState`, and rebuilds
 * the canonical `cycles` array via `rebuildCyclesFromLogs`.
 *
 * @param {string|object} floInput - Raw Flo JSON string or already-parsed object.
 * @param {object} [existingVaultState] - Current decrypted vault state (never mutated).
 * @returns {{ vaultState: object, stats: { importedCycles: number, importedLogDays: number, skippedRecords: number, warnings: string[] } }}
 */
export function importFloData(floInput, existingVaultState = createEmptyVaultState()) {
    let parsed;
    if (typeof floInput === 'string') {
        try {
            parsed = JSON.parse(floInput);
        } catch (err) {
            throw new Error(`Invalid Flo JSON input: ${err.message}`);
        }
    } else if (floInput && typeof floInput === 'object') {
        parsed = floInput;
    } else {
        throw new TypeError('Flo import input must be a JSON string or an object.');
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Flo JSON root must be a JSON object.');
    }

    const warnings = [];
    let skippedRecords = 0;

    const containers = collectSearchContainers(parsed);
    const rawCycles = extractRecordsFromContainers(containers, CYCLE_ARRAY_KEYS);
    const rawLogs = extractRecordsFromContainers(containers, LOG_ARRAY_KEYS);

    // 1. Parse & deduplicate imported cycles by startDate|endDate
    const parsedCycles = [];
    const seenCycleKeys = new Set();

    for (const rawCycle of rawCycles) {
        const cycle = parseCycleRecord(rawCycle);
        if (!cycle) {
            skippedRecords++;
            continue;
        }
        const dedupeKey = `${cycle.startDate}|${cycle.endDate}`;
        if (seenCycleKeys.has(dedupeKey)) continue;
        seenCycleKeys.add(dedupeKey);
        parsedCycles.push(cycle);
    }

    // 2. Parse & aggregate imported daily logs / point events
    const importedLogMap = new Map();
    for (const rawLog of rawLogs) {
        const applied = applyLogRecordToAccumulator(rawLog, importedLogMap);
        if (!applied) {
            skippedRecords++;
        }
    }

    if (parsedCycles.length === 0 && importedLogMap.size === 0) {
        warnings.push('No recognizable Flo cycle or daily log records were found.');
    }

    // 3. Non-destructive merge into cloned vault state
    const nextVault = cloneVaultState(existingVaultState);

    for (const [date, importedLog] of importedLogMap.entries()) {
        nextVault.dailyLogs[date] = mergeDailyLogEntry(
            nextVault.dailyLogs[date],
            importedLog
        );
    }

    // Combine existing cycles and newly imported cycles, then rebuild via Stage 1.
    const combinedCycles = [...nextVault.cycles, ...parsedCycles];
    nextVault.cycles = rebuildCyclesFromLogs(nextVault.dailyLogs, combinedCycles);

    return {
        vaultState: nextVault,
        stats: {
            importedCycles: parsedCycles.length,
            importedLogDays: importedLogMap.size,
            skippedRecords,
            warnings,
        },
    };
}
