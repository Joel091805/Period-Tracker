/**
 * Phase 2: Local Cryptography & Encrypted Storage Vault
 * Pure, framework-free ES6 module providing zero-backend encrypted persistence:
 *   - PBKDF2 (SHA-256, 310,000 iterations) key derivation from a 6-digit PIN
 *   - AES-GCM (256-bit key, fresh 12-byte random IV per write) authenticated encryption
 *   - Split IndexedDB storage (`app_meta` verifier + `encrypted_vault` ciphertext)
 *   - RAM-only unlocked session state with serialized atomic writes & portable backups
 */

import { DEFAULT_SETTINGS, createEmptyVaultState } from './predictionEngine.js';

// ---------------------------------------------------------------------------
// Constants & Configuration
// ---------------------------------------------------------------------------

export const DB_NAME = 'PeriodTrackerVaultDB';
export const DB_VERSION = 1;
export const META_STORE = 'app_meta';
export const VAULT_STORE = 'encrypted_vault';
export const VAULT_CONFIG_KEY = 'vault_config';
export const DEVICE_KEY_KEY = 'device_key';
export const MAIN_VAULT_KEY = 'main_vault';

const VAULT_MODE_DEVICE = 'device';
const VAULT_MODE_PIN = 'pin';

export const VAULT_SCHEMA_VERSION = 1;
export const PIN_LENGTH = 6;
export const MIN_BACKUP_PASSPHRASE_LENGTH = 6;

export const PBKDF2_ITERATIONS = 310_000;
const MIN_ALLOWED_ITERATIONS = 100_000;
const MAX_ALLOWED_ITERATIONS = 2_000_000;
const SALT_BYTE_LENGTH = 16;
const IV_BYTE_LENGTH = 12;
const AES_KEY_BIT_LENGTH = 256;

const VERIFIER_PAYLOAD = Object.freeze({ check: 'VAULT_OK' });
const BACKUP_FORMAT = 'period-tracker-encrypted-backup';
const BACKUP_VERSION = 1;

const PIN_REGEX = /^\d{6}$/;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

// ---------------------------------------------------------------------------
// Module-Private RAM Session & Concurrency State
// ---------------------------------------------------------------------------

/** @type {CryptoKey | null} */
let activeCryptoKey = null;

/** @type {object | null} */
let activeVaultState = null;

/** @type {'device' | 'pin' | null} */
let activeVaultMode = null;

/** @type {IDBDatabase | null} */
let openDbInstance = null;

/** @type {Promise<IDBDatabase> | null} */
let openDbPromise = null;

/**
 * Incremented whenever the DB handle is closed/deleted so an in-flight
 * indexedDB.open() cannot cache a stale handle after panicWipeVault().
 */
let dbEpoch = 0;

/**
 * Incremented on every lockVault() / panicWipeVault() to invalidate in-flight
 * async operations so they cannot repopulate RAM or write after a lock/wipe.
 */
let sessionEpoch = 0;

/**
 * Serializes state-mutating async operations (commitVaultState, changeVaultPin,
 * importEncryptedBackup) to prevent lost-update races.
 */
let writeQueue = Promise.resolve();

// ---------------------------------------------------------------------------
// Validation & Normalization Helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if `pin` is a strictly valid 6-digit numeric string.
 * Rejects numbers (which drop leading zeros), whitespace, and non-digit characters.
 */
export function isValidPin(pin) {
    return typeof pin === 'string' && PIN_REGEX.test(pin);
}

function assertValidPin(pin, label = 'PIN') {
    if (!isValidPin(pin)) {
        throw new RangeError(`${label} must be a ${PIN_LENGTH}-digit numeric string.`);
    }
}

function assertValidBackupPassphrase(passphrase) {
    if (
        typeof passphrase !== 'string' ||
        passphrase.length < MIN_BACKUP_PASSPHRASE_LENGTH
    ) {
        throw new RangeError(
            `Backup passphrase must be a string of at least ${MIN_BACKUP_PASSPHRASE_LENGTH} characters.`
        );
    }
}

function assertCryptoAvailable() {
    if (
        typeof globalThis.crypto === 'undefined' ||
        !globalThis.crypto.subtle ||
        typeof globalThis.crypto.getRandomValues !== 'function'
    ) {
        throw new Error('Web Crypto API (crypto.subtle) is not available in this environment.');
    }
}

function assertIndexedDbAvailable() {
    if (typeof globalThis.indexedDB === 'undefined') {
        throw new Error('IndexedDB is not available in this environment.');
    }
}

function assertSafeIterations(iterations) {
    if (
        typeof iterations !== 'number' ||
        !Number.isInteger(iterations) ||
        iterations < MIN_ALLOWED_ITERATIONS ||
        iterations > MAX_ALLOWED_ITERATIONS
    ) {
        throw new RangeError(
            `Invalid PBKDF2 iteration count: ${iterations}.`
        );
    }
}

function deepClone(value) {
    if (typeof globalThis.structuredClone === 'function') {
        return globalThis.structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
}

/**
 * Validates and normalizes a vault state object to match the Phase 1/2 schema.
 * Round-trips through JSON so RAM state is guaranteed identical to the persisted
 * ciphertext payload (preventing Date/Map/Set/undefined drift).
 *
 * @param {object} candidate
 * @param {{ strict?: boolean }} [options]
 */
function normalizeVaultState(candidate, { strict = false } = {}) {
    if (
        candidate === null ||
        candidate === undefined ||
        typeof candidate !== 'object' ||
        Array.isArray(candidate)
    ) {
        throw new TypeError('Vault state must be a plain object.');
    }

    if (strict) {
        if (candidate.schemaVersion !== VAULT_SCHEMA_VERSION) {
            throw new Error(
                `Unsupported or missing vault schemaVersion: ${candidate.schemaVersion}.`
            );
        }
        if (
            !candidate.settings ||
            typeof candidate.settings !== 'object' ||
            Array.isArray(candidate.settings)
        ) {
            throw new TypeError('Vault state is missing a valid "settings" object.');
        }
        if (!Array.isArray(candidate.cycles)) {
            throw new TypeError('Vault state is missing a valid "cycles" array.');
        }
        if (
            !candidate.dailyLogs ||
            typeof candidate.dailyLogs !== 'object' ||
            Array.isArray(candidate.dailyLogs)
        ) {
            throw new TypeError('Vault state is missing a valid "dailyLogs" object.');
        }
    }

    // JSON round-trip guarantees serializability and exact RAM <-> IndexedDB parity.
    const cloned = JSON.parse(JSON.stringify(candidate));

    if (
        cloned.schemaVersion !== undefined &&
        cloned.schemaVersion !== VAULT_SCHEMA_VERSION
    ) {
        throw new Error(
            `Unsupported vault schemaVersion: ${cloned.schemaVersion}.`
        );
    }

    if (
        cloned.settings !== undefined &&
        (cloned.settings === null ||
            typeof cloned.settings !== 'object' ||
            Array.isArray(cloned.settings))
    ) {
        throw new TypeError('Vault state "settings" must be an object.');
    }

    if (cloned.cycles !== undefined && !Array.isArray(cloned.cycles)) {
        throw new TypeError('Vault state "cycles" must be an array.');
    }

    if (
        cloned.dailyLogs !== undefined &&
        (cloned.dailyLogs === null ||
            typeof cloned.dailyLogs !== 'object' ||
            Array.isArray(cloned.dailyLogs))
    ) {
        throw new TypeError('Vault state "dailyLogs" must be an object.');
    }

    return {
        schemaVersion: VAULT_SCHEMA_VERSION,
        settings: {
            ...DEFAULT_SETTINGS,
            ...(cloned.settings || {}),
        },
        cycles: Array.isArray(cloned.cycles) ? cloned.cycles : [],
        dailyLogs: cloned.dailyLogs || {},
    };
}

function enqueueWrite(taskFn) {
    const run = writeQueue.then(taskFn, taskFn);
    // Keep the queue chain alive even if an individual task rejects.
    writeQueue = run.then(
        () => undefined,
        () => undefined
    );
    return run;
}

// ---------------------------------------------------------------------------
// Binary & Base64 Encoding Utilities
// ---------------------------------------------------------------------------

function toUint8Array(value, label = 'binary value') {
    if (value instanceof Uint8Array) {
        return value;
    }
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    if (ArrayBuffer.isView(value)) {
        return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    }
    throw new TypeError(`Expected ArrayBuffer or TypedArray for ${label}.`);
}

function toArrayBuffer(value, label = 'binary value') {
    const bytes = toUint8Array(value, label);
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/**
 * Encodes binary data to Base64 in chunks to avoid call-stack overflow on large vaults.
 */
function bytesToBase64(bytes) {
    const view = toUint8Array(bytes, 'Base64 input');
    if (typeof globalThis.btoa === 'function') {
        const CHUNK_SIZE = 0x8000;
        const parts = [];
        for (let i = 0; i < view.length; i += CHUNK_SIZE) {
            const chunk = view.subarray(i, i + CHUNK_SIZE);
            parts.push(String.fromCharCode(...chunk));
        }
        return globalThis.btoa(parts.join(''));
    }
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64');
    }
    throw new Error('No Base64 encoder available in this environment.');
}

/**
 * Strictly decodes a Base64 string into a Uint8Array.
 */
function base64ToBytes(base64String, label = 'Base64 string') {
    if (typeof base64String !== 'string' || base64String.length === 0) {
        throw new Error(`Invalid ${label}: must be a non-empty Base64 string.`);
    }

    const cleaned = base64String.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned) || cleaned.length % 4 !== 0) {
        throw new Error(`Invalid ${label}: malformed Base64 encoding.`);
    }

    if (typeof globalThis.atob === 'function') {
        const binary = globalThis.atob(cleaned);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    if (typeof Buffer !== 'undefined') {
        const buf = Buffer.from(cleaned, 'base64');
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength).slice();
    }

    throw new Error('No Base64 decoder available in this environment.');
}

// ---------------------------------------------------------------------------
// Web Crypto Primitives (PBKDF2 + AES-GCM)
// ---------------------------------------------------------------------------

function generateRandomBytes(length) {
    assertCryptoAvailable();
    return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Generates a non-extractable 256-bit AES-GCM CryptoKey for automatic device-mode encryption.
 */
async function generateDeviceKey() {
    assertCryptoAvailable();
    return globalThis.crypto.subtle.generateKey(
        {
            name: 'AES-GCM',
            length: AES_KEY_BIT_LENGTH,
        },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Derives a non-extractable 256-bit AES-GCM CryptoKey from a secret string and salt.
 */
async function deriveAesKey(secret, salt, iterations = PBKDF2_ITERATIONS) {
    assertCryptoAvailable();
    assertSafeIterations(iterations);

    const saltBytes = toUint8Array(salt, 'salt');
    if (saltBytes.byteLength !== SALT_BYTE_LENGTH) {
        throw new RangeError(`Salt must be exactly ${SALT_BYTE_LENGTH} bytes.`);
    }

    const subtle = globalThis.crypto.subtle;
    const baseKey = await subtle.importKey(
        'raw',
        textEncoder.encode(secret),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
    );

    return subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations,
            hash: 'SHA-256',
        },
        baseKey,
        {
            name: 'AES-GCM',
            length: AES_KEY_BIT_LENGTH,
        },
        false,
        ['encrypt', 'decrypt']
    );
}

/**
 * Encrypts a JSON-serializable payload with AES-GCM using a fresh 12-byte random IV.
 * @returns {Promise<{ iv: Uint8Array, ciphertext: ArrayBuffer }>}
 */
async function encryptJsonPayload(cryptoKey, payload) {
    assertCryptoAvailable();
    const iv = generateRandomBytes(IV_BYTE_LENGTH);
    const plaintextBytes = textEncoder.encode(JSON.stringify(payload));
    const ciphertext = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        plaintextBytes
    );
    return {
        iv,
        ciphertext: toArrayBuffer(ciphertext, 'ciphertext'),
    };
}

/**
 * Decrypts an AES-GCM ciphertext and parses the resulting UTF-8 JSON payload.
 */
async function decryptJsonPayload(cryptoKey, iv, ciphertext) {
    assertCryptoAvailable();
    const ivBytes = toUint8Array(iv, 'iv');
    if (ivBytes.byteLength !== IV_BYTE_LENGTH) {
        throw new RangeError(`IV must be exactly ${IV_BYTE_LENGTH} bytes.`);
    }
    const cipherBytes = toUint8Array(ciphertext, 'ciphertext');

    const plaintextBuffer = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes },
        cryptoKey,
        cipherBytes
    );
    const jsonString = textDecoder.decode(plaintextBuffer);
    return JSON.parse(jsonString);
}

// ---------------------------------------------------------------------------
// IndexedDB Layer (`PeriodTrackerVaultDB`)
// ---------------------------------------------------------------------------

function closeTrackedDb() {
    dbEpoch += 1;
    openDbPromise = null;
    if (openDbInstance) {
        try {
            openDbInstance.close();
        } catch {
            // Ignore close errors on already-closed connections.
        }
        openDbInstance = null;
    }
}

function openVaultDb() {
    assertIndexedDbAvailable();

    if (openDbInstance) {
        return Promise.resolve(openDbInstance);
    }
    if (openDbPromise) {
        return openDbPromise;
    }

    const myDbEpoch = dbEpoch;
    const promise = new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE);
            }
            if (!db.objectStoreNames.contains(VAULT_STORE)) {
                db.createObjectStore(VAULT_STORE);
            }
        };

        request.onsuccess = () => {
            const db = request.result;
            if (myDbEpoch !== dbEpoch) {
                // Database was closed/wiped while opening; close immediately to avoid blocking deleteDatabase.
                try {
                    db.close();
                } catch {
                    // Ignore close error.
                }
                reject(new Error(`IndexedDB "${DB_NAME}" was closed while opening.`));
                return;
            }

            db.onversionchange = () => {
                closeTrackedDb();
            };
            db.onclose = () => {
                if (openDbInstance === db) {
                    openDbInstance = null;
                }
            };
            openDbInstance = db;
            openDbPromise = null;
            resolve(db);
        };

        request.onerror = () => {
            if (openDbPromise === promise) {
                openDbPromise = null;
            }
            reject(request.error || new Error(`Failed to open IndexedDB "${DB_NAME}".`));
        };

        request.onblocked = () => {
            if (openDbPromise === promise) {
                openDbPromise = null;
            }
            reject(new Error(`Opening IndexedDB "${DB_NAME}" was blocked by another connection.`));
        };
    });

    openDbPromise = promise;
    return promise;
}

async function idbGet(storeName, key) {
    const db = await openVaultDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const req = store.get(key);

        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error || new Error(`Failed to read "${key}" from "${storeName}".`));
    });
}

async function idbPut(storeName, key, value) {
    const db = await openVaultDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        store.put(value, key);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error(`Failed to write "${key}" to "${storeName}".`));
        tx.onabort = () => reject(tx.error || new Error(`Transaction aborted writing "${key}" to "${storeName}".`));
    });
}

/**
 * Atomically writes `vault_config` (`app_meta`), optional `device_key`, and `main_vault`
 * (`encrypted_vault`) inside a single multi-store readwrite transaction so they can never diverge.
 */
async function idbPutMetaAndVaultAtomic(
    metaRecord,
    vaultRecord,
    { deviceKey = null, deleteDeviceKey = false } = {}
) {
    const db = await openVaultDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([META_STORE, VAULT_STORE], 'readwrite');
        const metaStore = tx.objectStore(META_STORE);
        metaStore.put(metaRecord, VAULT_CONFIG_KEY);
        if (deviceKey) {
            metaStore.put(deviceKey, DEVICE_KEY_KEY);
        } else if (deleteDeviceKey) {
            metaStore.delete(DEVICE_KEY_KEY);
        }
        tx.objectStore(VAULT_STORE).put(vaultRecord, MAIN_VAULT_KEY);

        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('Failed to commit vault records atomically.'));
        tx.onabort = () => reject(tx.error || new Error('Atomic vault transaction was aborted.'));
    });
}

function idbDeleteDatabase() {
    assertIndexedDbAvailable();
    closeTrackedDb();

    return new Promise((resolve, reject) => {
        const request = globalThis.indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error(`Failed to delete IndexedDB "${DB_NAME}".`));
        request.onblocked = () => reject(new Error(`Deleting IndexedDB "${DB_NAME}" was blocked by another tab or connection.`));
    });
}

// ---------------------------------------------------------------------------
// Internal Verification Helper
// ---------------------------------------------------------------------------

async function verifyPinAgainstConfig(pin, config) {
    if (
        !config ||
        !config.salt ||
        !config.verifierIv ||
        !config.verifierCiphertext
    ) {
        throw new Error('Vault metadata is missing or corrupted.');
    }

    const iterations = config.iterations ?? PBKDF2_ITERATIONS;
    const candidateKey = await deriveAesKey(pin, config.salt, iterations);

    let decodedVerifier;
    try {
        decodedVerifier = await decryptJsonPayload(
            candidateKey,
            config.verifierIv,
            config.verifierCiphertext
        );
    } catch {
        throw new Error('Invalid PIN.');
    }

    if (!decodedVerifier || decodedVerifier.check !== VERIFIER_PAYLOAD.check) {
        throw new Error('Invalid PIN.');
    }

    return candidateKey;
}

// ---------------------------------------------------------------------------
// Public Module API
// ---------------------------------------------------------------------------

function isPinConfig(config) {
    return Boolean(
        config &&
            config.mode !== VAULT_MODE_DEVICE &&
            config.salt &&
            config.verifierIv &&
            config.verifierCiphertext
    );
}

/**
 * Checks whether a vault has been initialized in IndexedDB (`app_meta` -> `vault_config`)
 * in either `'device'` or `'pin'` mode, and refreshes the cached vault mode.
 * @returns {Promise<boolean>}
 */
export async function hasExistingVault() {
    const config = await idbGet(META_STORE, VAULT_CONFIG_KEY);
    if (!config) {
        activeVaultMode = null;
        return false;
    }

    if (config.mode === VAULT_MODE_DEVICE) {
        const deviceKey = await idbGet(META_STORE, DEVICE_KEY_KEY);
        if (deviceKey) {
            activeVaultMode = VAULT_MODE_DEVICE;
            return true;
        }
        activeVaultMode = null;
        return false;
    }

    if (isPinConfig(config)) {
        activeVaultMode = VAULT_MODE_PIN;
        return true;
    }

    activeVaultMode = null;
    return false;
}

/**
 * Returns true only when the stored vault metadata is in `'pin'` mode, and false otherwise.
 * @returns {boolean}
 */
export function isPinLockEnabled() {
    return activeVaultMode === VAULT_MODE_PIN;
}

/**
 * Creates a new encrypted vault protected by an automatic non-extractable device CryptoKey,
 * persists the metadata, key, and encrypted initial state atomically to IndexedDB, and unlocks
 * the session in RAM with zero PIN friction.
 *
 * @param {object} [initialState] - Optional initial vault state (defaults to empty schema).
 * @returns {Promise<object>} Deep-cloned initial vault state.
 */
export async function createDeviceVault(initialState) {
    const normalizedState =
        initialState === undefined
            ? createEmptyVaultState()
            : normalizeVaultState(initialState);
    const startEpoch = sessionEpoch;

    return enqueueWrite(async () => {
        if (startEpoch !== sessionEpoch) {
            throw new Error('Vault creation aborted because the session was locked or wiped.');
        }

        const exists = await hasExistingVault();
        if (exists) {
            throw new Error('A vault already exists. Unlock it or wipe it before creating a new vault.');
        }

        const deviceKey = await generateDeviceKey();
        const vaultEncrypted = await encryptJsonPayload(deviceKey, normalizedState);

        if (startEpoch !== sessionEpoch) {
            throw new Error('Vault creation aborted because the session was locked or wiped.');
        }

        const nowIso = new Date().toISOString();
        const metaRecord = {
            mode: VAULT_MODE_DEVICE,
            updatedAt: nowIso,
        };
        const vaultRecord = {
            iv: vaultEncrypted.iv,
            ciphertext: vaultEncrypted.ciphertext,
            schemaVersion: VAULT_SCHEMA_VERSION,
            updatedAt: nowIso,
        };

        await idbPutMetaAndVaultAtomic(metaRecord, vaultRecord, { deviceKey });

        if (startEpoch !== sessionEpoch) {
            throw new Error('Vault was locked or wiped while finalizing creation.');
        }

        activeCryptoKey = deviceKey;
        activeVaultState = normalizedState;
        activeVaultMode = VAULT_MODE_DEVICE;
        return deepClone(activeVaultState);
    });
}

/**
 * Unlocks an existing `'device'`-mode vault automatically using the stored non-extractable
 * device CryptoKey.
 *
 * @returns {Promise<object>} Deep-cloned decrypted vault state.
 */
export async function unlockDeviceVault() {
    const startEpoch = sessionEpoch;
    const config = await idbGet(META_STORE, VAULT_CONFIG_KEY);
    if (!config) {
        activeVaultMode = null;
        throw new Error('No existing vault found.');
    }
    if (config.mode !== VAULT_MODE_DEVICE) {
        if (isPinConfig(config)) {
            activeVaultMode = VAULT_MODE_PIN;
        }
        throw new Error('Vault requires a 6-digit PIN to unlock.');
    }

    const deviceKey = await idbGet(META_STORE, DEVICE_KEY_KEY);
    if (!deviceKey) {
        throw new Error('Device encryption key is missing or corrupted.');
    }

    const vaultRecord = await idbGet(VAULT_STORE, MAIN_VAULT_KEY);
    if (!vaultRecord || !vaultRecord.iv || !vaultRecord.ciphertext) {
        throw new Error('Encrypted vault payload is missing or corrupted.');
    }

    let decryptedState;
    try {
        decryptedState = await decryptJsonPayload(
            deviceKey,
            vaultRecord.iv,
            vaultRecord.ciphertext
        );
    } catch {
        throw new Error('Failed to decrypt device vault payload.');
    }

    const normalizedState = normalizeVaultState(decryptedState, { strict: true });

    if (startEpoch !== sessionEpoch) {
        throw new Error('Vault unlock aborted because the session was locked or wiped.');
    }

    activeCryptoKey = deviceKey;
    activeVaultState = normalizedState;
    activeVaultMode = VAULT_MODE_DEVICE;
    return deepClone(activeVaultState);
}

/**
 * Creates a new encrypted vault protected by a 6-digit PIN, persists the verifier
 * and encrypted initial state atomically to IndexedDB, and unlocks the session in RAM.
 *
 * @param {string} pin - 6-digit numeric PIN string.
 * @param {object} [initialState] - Optional initial vault state (defaults to empty schema).
 * @returns {Promise<object>} Deep-cloned initial vault state.
 */
export async function createVault(pin, initialState) {
    assertValidPin(pin);
    const normalizedState =
        initialState === undefined
            ? createEmptyVaultState()
            : normalizeVaultState(initialState);
    const startEpoch = sessionEpoch;

    return enqueueWrite(async () => {
        if (startEpoch !== sessionEpoch) {
            throw new Error('Vault creation aborted because the session was locked or wiped.');
        }

        const exists = await hasExistingVault();
        if (exists) {
            throw new Error('A vault already exists. Unlock it or wipe it before creating a new vault.');
        }

        const salt = generateRandomBytes(SALT_BYTE_LENGTH);
        const derivedKey = await deriveAesKey(pin, salt, PBKDF2_ITERATIONS);

        const verifierEncrypted = await encryptJsonPayload(derivedKey, VERIFIER_PAYLOAD);
        const vaultEncrypted = await encryptJsonPayload(derivedKey, normalizedState);

        if (startEpoch !== sessionEpoch) {
            throw new Error('Vault creation aborted because the session was locked or wiped.');
        }

        const nowIso = new Date().toISOString();
        const metaRecord = {
            mode: VAULT_MODE_PIN,
            salt,
            verifierIv: verifierEncrypted.iv,
            verifierCiphertext: verifierEncrypted.ciphertext,
            iterations: PBKDF2_ITERATIONS,
            updatedAt: nowIso,
        };
        const vaultRecord = {
            iv: vaultEncrypted.iv,
            ciphertext: vaultEncrypted.ciphertext,
            schemaVersion: VAULT_SCHEMA_VERSION,
            updatedAt: nowIso,
        };

        await idbPutMetaAndVaultAtomic(metaRecord, vaultRecord, { deleteDeviceKey: true });

        if (startEpoch !== sessionEpoch) {
            throw new Error('Vault was locked or wiped while finalizing creation.');
        }

        activeCryptoKey = derivedKey;
        activeVaultState = normalizedState;
        activeVaultMode = VAULT_MODE_PIN;
        return deepClone(activeVaultState);
    });
}

/**
 * Unlocks an existing vault using the 6-digit PIN. Validates the PIN against the
 * stored verifier before decrypting `main_vault` into RAM. Throws cleanly on wrong PIN.
 *
 * @param {string} pin - 6-digit numeric PIN string.
 * @returns {Promise<object>} Deep-cloned decrypted vault state.
 */
export async function unlockVault(pin) {
    assertValidPin(pin);

    const startEpoch = sessionEpoch;
    const config = await idbGet(META_STORE, VAULT_CONFIG_KEY);
    if (!config) {
        activeVaultMode = null;
        throw new Error('No existing vault found.');
    }
    if (config.mode === VAULT_MODE_DEVICE) {
        activeVaultMode = VAULT_MODE_DEVICE;
        throw new Error('Vault is in device mode and does not require a PIN.');
    }

    const candidateKey = await verifyPinAgainstConfig(pin, config);

    const vaultRecord = await idbGet(VAULT_STORE, MAIN_VAULT_KEY);
    if (!vaultRecord || !vaultRecord.iv || !vaultRecord.ciphertext) {
        throw new Error('Encrypted vault payload is missing or corrupted.');
    }

    let decryptedState;
    try {
        decryptedState = await decryptJsonPayload(
            candidateKey,
            vaultRecord.iv,
            vaultRecord.ciphertext
        );
    } catch {
        throw new Error('Failed to decrypt vault payload.');
    }

    const normalizedState = normalizeVaultState(decryptedState, { strict: true });

    if (startEpoch !== sessionEpoch) {
        throw new Error('Vault unlock aborted because the session was locked or wiped.');
    }

    activeCryptoKey = candidateKey;
    activeVaultState = normalizedState;
    activeVaultMode = VAULT_MODE_PIN;
    return deepClone(activeVaultState);
}

/**
 * Immediately clears the active CryptoKey and decrypted vault state from RAM.
 */
export function lockVault() {
    sessionEpoch += 1;
    activeCryptoKey = null;
    activeVaultState = null;
}

/**
 * Returns true if the vault is currently unlocked in RAM.
 * @returns {boolean}
 */
export function isVaultUnlocked() {
    return activeCryptoKey !== null && activeVaultState !== null;
}

/**
 * Returns a deep-cloned snapshot of the currently unlocked vault state.
 * Throws if the vault is locked.
 * @returns {object}
 */
export function getVaultState() {
    if (!isVaultUnlocked()) {
        throw new Error('Vault is locked. Unlock the vault before reading state.');
    }
    return deepClone(activeVaultState);
}

/**
 * Applies a state mutation to a cloned copy of the active RAM state, encrypts the
 * updated state with a fresh 12-byte IV, persists it to IndexedDB, and updates RAM state.
 * Serialized via an internal write queue to prevent lost-update races.
 *
 * @param {(draftState: object) => (object | void | Promise<object | void>)} updaterFn
 * @returns {Promise<object>} Deep-cloned committed vault state.
 */
export async function commitVaultState(updaterFn) {
    if (typeof updaterFn !== 'function') {
        throw new TypeError('commitVaultState requires an updater function.');
    }
    if (!isVaultUnlocked()) {
        throw new Error('Vault is locked. Unlock the vault before committing changes.');
    }

    const startEpoch = sessionEpoch;

    return enqueueWrite(async () => {
        if (startEpoch !== sessionEpoch || !isVaultUnlocked()) {
            throw new Error('Commit aborted because the vault was locked before the save began.');
        }

        const keySnapshot = activeCryptoKey;
        const draft = deepClone(activeVaultState);

        const result = await updaterFn(draft);
        const nextRawState = result === undefined ? draft : result;
        const normalizedNext = normalizeVaultState(nextRawState);

        const encrypted = await encryptJsonPayload(keySnapshot, normalizedNext);

        if (startEpoch !== sessionEpoch || !isVaultUnlocked()) {
            throw new Error('Commit aborted because the vault was locked during the save.');
        }

        const vaultRecord = {
            iv: encrypted.iv,
            ciphertext: encrypted.ciphertext,
            schemaVersion: VAULT_SCHEMA_VERSION,
            updatedAt: new Date().toISOString(),
        };

        await idbPut(VAULT_STORE, MAIN_VAULT_KEY, vaultRecord);

        if (startEpoch !== sessionEpoch) {
            throw new Error('Vault was locked while finalizing commit.');
        }

        activeVaultState = normalizedNext;
        return deepClone(activeVaultState);
    });
}

/**
 * Upgrades the active unlocked vault from `'device'` mode to `'pin'` mode:
 * validates `newPin`, derives a PBKDF2 AES-GCM key, re-encrypts the in-memory state,
 * saves `'pin'` metadata, and deletes the stored device CryptoKey atomically.
 *
 * @param {string} newPin - 6-digit numeric PIN string.
 * @returns {Promise<void>}
 */
export async function enablePinLock(newPin) {
    assertValidPin(newPin, 'New PIN');
    if (!isVaultUnlocked()) {
        throw new Error('Vault is locked. Unlock the vault before enabling PIN lock.');
    }

    const startEpoch = sessionEpoch;

    return enqueueWrite(async () => {
        if (startEpoch !== sessionEpoch || !isVaultUnlocked()) {
            throw new Error('Enabling PIN lock aborted because the session was locked or wiped.');
        }

        const stateToReencrypt = deepClone(activeVaultState);
        const newSalt = generateRandomBytes(SALT_BYTE_LENGTH);
        const newKey = await deriveAesKey(newPin, newSalt, PBKDF2_ITERATIONS);

        const newVerifier = await encryptJsonPayload(newKey, VERIFIER_PAYLOAD);
        const newVault = await encryptJsonPayload(newKey, stateToReencrypt);

        if (startEpoch !== sessionEpoch || !isVaultUnlocked()) {
            throw new Error('Enabling PIN lock aborted because the session was locked or wiped.');
        }

        const nowIso = new Date().toISOString();
        const nextMetaRecord = {
            mode: VAULT_MODE_PIN,
            salt: newSalt,
            verifierIv: newVerifier.iv,
            verifierCiphertext: newVerifier.ciphertext,
            iterations: PBKDF2_ITERATIONS,
            updatedAt: nowIso,
        };
        const nextVaultRecord = {
            iv: newVault.iv,
            ciphertext: newVault.ciphertext,
            schemaVersion: VAULT_SCHEMA_VERSION,
            updatedAt: nowIso,
        };

        await idbPutMetaAndVaultAtomic(nextMetaRecord, nextVaultRecord, {
            deleteDeviceKey: true,
        });

        if (startEpoch !== sessionEpoch) {
            throw new Error('Vault was locked or wiped while enabling PIN lock.');
        }

        activeCryptoKey = newKey;
        activeVaultState = stateToReencrypt;
        activeVaultMode = VAULT_MODE_PIN;
    });
}

/**
 * Transitions a `'pin'`-protected vault back to `'device'` mode: verifies `currentPin`,
 * generates a fresh non-extractable device CryptoKey, re-encrypts the current vault state
 * under it, and updates metadata to `'device'` mode atomically.
 *
 * @param {string} currentPin - Current 6-digit numeric PIN string.
 * @returns {Promise<void>}
 */
export async function disablePinLock(currentPin) {
    assertValidPin(currentPin, 'Current PIN');

    const startEpoch = sessionEpoch;
    const wasUnlocked = isVaultUnlocked();

    return enqueueWrite(async () => {
        if (startEpoch !== sessionEpoch) {
            throw new Error('Disabling PIN lock aborted because the session was locked or wiped.');
        }

        const config = await idbGet(META_STORE, VAULT_CONFIG_KEY);
        if (!config) {
            throw new Error('No existing vault found.');
        }
        if (!isPinConfig(config)) {
            throw new Error('PIN lock is not currently enabled.');
        }

        const verifiedCurrentKey = await verifyPinAgainstConfig(currentPin, config);

        let stateToReencrypt;
        if (wasUnlocked && startEpoch === sessionEpoch) {
            stateToReencrypt = deepClone(activeVaultState);
        } else {
            const vaultRecord = await idbGet(VAULT_STORE, MAIN_VAULT_KEY);
            if (!vaultRecord || !vaultRecord.iv || !vaultRecord.ciphertext) {
                throw new Error('Encrypted vault payload is missing or corrupted.');
            }
            const decrypted = await decryptJsonPayload(
                verifiedCurrentKey,
                vaultRecord.iv,
                vaultRecord.ciphertext
            );
            stateToReencrypt = normalizeVaultState(decrypted, { strict: true });
        }

        const deviceKey = await generateDeviceKey();
        const newVault = await encryptJsonPayload(deviceKey, stateToReencrypt);

        if (startEpoch !== sessionEpoch) {
            throw new Error('Disabling PIN lock aborted because the session was locked or wiped.');
        }

        const nowIso = new Date().toISOString();
        const nextMetaRecord = {
            mode: VAULT_MODE_DEVICE,
            updatedAt: nowIso,
        };
        const nextVaultRecord = {
            iv: newVault.iv,
            ciphertext: newVault.ciphertext,
            schemaVersion: VAULT_SCHEMA_VERSION,
            updatedAt: nowIso,
        };

        await idbPutMetaAndVaultAtomic(nextMetaRecord, nextVaultRecord, { deviceKey });

        activeVaultMode = VAULT_MODE_DEVICE;
        if (wasUnlocked && startEpoch === sessionEpoch) {
            activeCryptoKey = deviceKey;
            activeVaultState = stateToReencrypt;
        }
    });
}

/**
 * Verifies the current 6-digit PIN and atomically re-encrypts the vault and verifier
 * under a newly generated 16-byte salt and key derived from the new 6-digit PIN.
 *
 * @param {string} currentPin - Current 6-digit PIN.
 * @param {string} newPin - New 6-digit PIN.
 * @returns {Promise<void>}
 */
export async function changeVaultPin(currentPin, newPin) {
    assertValidPin(currentPin, 'Current PIN');
    assertValidPin(newPin, 'New PIN');

    const startEpoch = sessionEpoch;
    const wasUnlocked = isVaultUnlocked();

    return enqueueWrite(async () => {
        if (startEpoch !== sessionEpoch) {
            throw new Error('PIN change aborted because the session was locked or wiped.');
        }

        const config = await idbGet(META_STORE, VAULT_CONFIG_KEY);
        if (!config) {
            throw new Error('No existing vault found.');
        }

        const verifiedCurrentKey = await verifyPinAgainstConfig(currentPin, config);

        let stateToReencrypt;
        if (wasUnlocked && startEpoch === sessionEpoch) {
            stateToReencrypt = deepClone(activeVaultState);
        } else {
            const vaultRecord = await idbGet(VAULT_STORE, MAIN_VAULT_KEY);
            if (!vaultRecord || !vaultRecord.iv || !vaultRecord.ciphertext) {
                throw new Error('Encrypted vault payload is missing or corrupted.');
            }
            const decrypted = await decryptJsonPayload(
                verifiedCurrentKey,
                vaultRecord.iv,
                vaultRecord.ciphertext
            );
            stateToReencrypt = normalizeVaultState(decrypted, { strict: true });
        }

        const newSalt = generateRandomBytes(SALT_BYTE_LENGTH);
        const newKey = await deriveAesKey(newPin, newSalt, PBKDF2_ITERATIONS);

        const newVerifier = await encryptJsonPayload(newKey, VERIFIER_PAYLOAD);
        const newVault = await encryptJsonPayload(newKey, stateToReencrypt);

        if (startEpoch !== sessionEpoch) {
            throw new Error('PIN change aborted because the session was locked or wiped.');
        }

        const nowIso = new Date().toISOString();
        const nextMetaRecord = {
            mode: VAULT_MODE_PIN,
            salt: newSalt,
            verifierIv: newVerifier.iv,
            verifierCiphertext: newVerifier.ciphertext,
            iterations: PBKDF2_ITERATIONS,
            updatedAt: nowIso,
        };
        const nextVaultRecord = {
            iv: newVault.iv,
            ciphertext: newVault.ciphertext,
            schemaVersion: VAULT_SCHEMA_VERSION,
            updatedAt: nowIso,
        };

        await idbPutMetaAndVaultAtomic(nextMetaRecord, nextVaultRecord, {
            deleteDeviceKey: true,
        });

        activeVaultMode = VAULT_MODE_PIN;
        // Preserve lock state: only update RAM key if the vault was unlocked before and still unlocked.
        if (wasUnlocked && startEpoch === sessionEpoch) {
            activeCryptoKey = newKey;
            activeVaultState = stateToReencrypt;
        }
    });
}

/**
 * Exports the currently unlocked vault state as a portable encrypted JSON string
 * protected by a standalone backup passphrase (minimum 6 characters).
 *
 * @param {string} backupPassphrase - Standalone passphrase (>= 6 characters).
 * @returns {Promise<string>} Portable `.enc.json` backup string.
 */
export async function exportEncryptedBackup(backupPassphrase) {
    assertValidBackupPassphrase(backupPassphrase);
    if (!isVaultUnlocked()) {
        throw new Error('Vault is locked. Unlock the vault before exporting a backup.');
    }

    const startEpoch = sessionEpoch;
    const stateSnapshot = deepClone(activeVaultState);
    const salt = generateRandomBytes(SALT_BYTE_LENGTH);
    const backupKey = await deriveAesKey(backupPassphrase, salt, PBKDF2_ITERATIONS);
    const encrypted = await encryptJsonPayload(backupKey, stateSnapshot);

    if (startEpoch !== sessionEpoch) {
        throw new Error('Backup export aborted because the vault was locked.');
    }

    const envelope = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        iterations: PBKDF2_ITERATIONS,
        salt: bytesToBase64(salt),
        iv: bytesToBase64(encrypted.iv),
        ciphertext: bytesToBase64(encrypted.ciphertext),
        exportedAt: new Date().toISOString(),
    };

    return JSON.stringify(envelope, null, 2);
}

/**
 * Decrypts a portable `.enc.json` backup string using `backupPassphrase` and commits
 * the restored state to the active unlocked vault.
 *
 * @param {string} backupJsonString - JSON string created by `exportEncryptedBackup`.
 * @param {string} backupPassphrase - Passphrase used to encrypt the backup.
 * @returns {Promise<object>} Deep-cloned restored vault state.
 */
export async function importEncryptedBackup(backupJsonString, backupPassphrase) {
    assertValidBackupPassphrase(backupPassphrase);
    if (!isVaultUnlocked()) {
        throw new Error('Vault is locked. Unlock the vault before importing a backup.');
    }
    if (typeof backupJsonString !== 'string' || backupJsonString.trim().length === 0) {
        throw new TypeError('Backup input must be a non-empty JSON string.');
    }

    const startEpoch = sessionEpoch;

    let envelope;
    try {
        envelope = JSON.parse(backupJsonString);
    } catch (err) {
        throw new Error(`Invalid backup JSON: ${err.message}`);
    }

    if (
        !envelope ||
        typeof envelope !== 'object' ||
        envelope.format !== BACKUP_FORMAT ||
        envelope.version !== BACKUP_VERSION
    ) {
        throw new Error('Unsupported or invalid encrypted backup format.');
    }

    const iterations = envelope.iterations ?? PBKDF2_ITERATIONS;
    assertSafeIterations(iterations);

    const salt = base64ToBytes(envelope.salt, 'backup salt');
    if (salt.byteLength !== SALT_BYTE_LENGTH) {
        throw new Error('Invalid backup salt length.');
    }

    const iv = base64ToBytes(envelope.iv, 'backup IV');
    if (iv.byteLength !== IV_BYTE_LENGTH) {
        throw new Error('Invalid backup IV length.');
    }

    const ciphertext = base64ToBytes(envelope.ciphertext, 'backup ciphertext');
    const backupKey = await deriveAesKey(backupPassphrase, salt, iterations);

    let decryptedState;
    try {
        decryptedState = await decryptJsonPayload(backupKey, iv, ciphertext);
    } catch {
        throw new Error('Failed to decrypt backup. Check the backup passphrase.');
    }

    const normalizedState = normalizeVaultState(decryptedState, { strict: true });

    if (startEpoch !== sessionEpoch) {
        throw new Error('Backup import aborted because the session changed or was locked.');
    }

    return commitVaultState(() => {
        if (startEpoch !== sessionEpoch) {
            throw new Error('Backup import aborted because the session changed or was locked.');
        }
        return normalizedState;
    });
}

/**
 * Immediately locks RAM state, closes any open IndexedDB handles, and deletes
 * `PeriodTrackerVaultDB` completely.
 *
 * @returns {Promise<void>}
 */
export async function panicWipeVault() {
    lockVault();
    activeVaultMode = null;
    await idbDeleteDatabase();
    activeVaultMode = null;
}
