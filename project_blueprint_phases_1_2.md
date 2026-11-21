# Project Blueprint: Core Engine & Encrypted Vault (Phases 1 & 2)

## 1. Scope & Architectural Boundary
This document defines the **headless core engine** for a local-first, privacy-preserving menstrual cycle tracker. It covers **Phase 1 (Cycle Prediction Engine & Flo Data Importer)** and **Phase 2 (Local Cryptography & Encrypted Storage)** only.

* **Headless Design:** All business logic, forecasting math, data migration, and encryption live in framework-free ES6 JavaScript modules (`js/`).
* **Zero-Backend Privacy:** No external servers, databases, analytics SDKs, or third-party dependencies are used. All data remains encrypted on the user's device.
* **UI Decoupling:** These modules expose clean state and forecast objects so any custom frontend (Phase 3) can consume them without touching storage or prediction internals.

---

## 2. Target Repository Structure (Phases 1 & 2)

```text
Period-Tracker/
├── PLAN.md                 # Architecture, schemas & algorithm specifications (this file)
├── .gitignore              # Excludes OS files, editor configs, and *.enc.json test exports
└── js/
    ├── predictionEngine.js # Phase 1: Pure JS forecasting engine (EWMA, outlier guard, luteal math)
    ├── floImporter.js      # Phase 1: Parser & normalizer for historical Flo JSON data exports
    └── vaultCrypto.js      # Phase 2: Web Crypto key derivation, AES-GCM encryption & IndexedDB I/O
```

---

## 3. Tech Stack & Browser APIs

| Layer | Technology | Role & Implementation Constraints |
| :--- | :--- | :--- |
| **Core Logic** | Vanilla JavaScript (ES6+ Modules) | Pure `type="module"` files with zero runtime npm dependencies or external CDNs. |
| **Client Storage** | Browser `IndexedDB` | Asynchronous structured local storage partitioned into unencrypted metadata and encrypted vault blobs. |
| **Cryptography** | Browser `Web Crypto API` (`crypto.subtle`) | `PBKDF2` (SHA-256, 310,000 iterations) for key derivation; `AES-GCM` (256-bit key, fresh 12-byte random IV per save) for authenticated encryption. |
| **Date Handling** | Local ISO Date Strings (`YYYY-MM-DD`) | Strict local calendar-day arithmetic (noon-anchored `Date` objects) to prevent UTC timezone off-by-one shifts. |

---

## 4. Data Schemas & Storage Design

### 4.1 IndexedDB Database & Object Stores (`PeriodTrackerVaultDB`)
Storage is split into two object stores so the application can verify vault existence and derive keys before decrypting sensitive records:

1. **`app_meta` (Unencrypted Metadata Store)**
   * Key: `'vault_config'`
   * Value Structure:
     * `salt`: `Uint8Array(16)` — Random cryptographic salt generated at vault creation.
     * `verifierIv`: `Uint8Array(12)` — Random IV for the PIN verification token.
     * `verifierCiphertext`: `ArrayBuffer` — Encrypted known constant (`{ check: "VAULT_OK" }`) used to validate the PIN before decrypting user records.
     * `iterations`: `310000` — PBKDF2 iteration count.
     * `updatedAt`: ISO 8601 timestamp string.

2. **`encrypted_vault` (Ciphertext Payload Store)**
   * Key: `'main_vault'`
   * Value Structure:
     * `iv`: `Uint8Array(12)` — Fresh random initialization vector generated on every write.
     * `ciphertext`: `ArrayBuffer` — AES-GCM encrypted JSON string of the complete vault state.
     * `schemaVersion`: `1`
     * `updatedAt`: ISO 8601 timestamp string.

### 4.2 Decrypted In-Memory Vault Schema (RAM Only)
Exists only inside private module memory while the session is unlocked:

```json
{
  "schemaVersion": 1,
  "settings": {
    "defaultCycleLength": 28,
    "defaultPeriodLength": 5,
    "lutealPhaseLength": 14,
    "autoLockMinutes": 5
  },
  "cycles": [
    {
      "id": "cyc_2026_10_14",
      "startDate": "2026-10-14",
      "endDate": "2026-10-18",
      "confirmedOvulationDate": null,
      "isOutlier": false
    }
  ],
  "dailyLogs": {
    "2026-10-14": {
      "flow": "medium",
      "lhTest": null,
      "bbt": null,
      "cervicalMucus": null,
      "symptoms": ["cramps", "fatigue"],
      "mood": "low_energy",
      "note": ""
    }
  }
}
```

#### Allowed Field Enumerations
* **`flow`:** `"none"` | `"spotting"` | `"light"` | `"medium"` | `"heavy"`
* **`lhTest`:** `null` | `"negative"` | `"positive"`
* **`bbt`:** `null` | `number` (Basal Body Temperature in °C or °F)
* **`cervicalMucus`:** `null` | `"dry"` | `"sticky"` | `"creamy"` | `"egg_white"`
* **`symptoms`:** Array of `"cramps"`, `"bloating"`, `"headache"`, `"fatigue"`, `"tender_breasts"`, `"acne"`, `"backache"`, `"nausea"`
* **`mood`:** `null` | `"calm"` | `"happy"` | `"sensitive"` | `"irritable"` | `"low_energy"`

---

## 5. Phase 1 Specifications: Forecasting Engine & Importer

### 5.1 Cycle Prediction Engine (`js/predictionEngine.js`)
Executes a deterministic **4-stage pipeline** every time vault state is loaded or mutated:

#### Stage 1: Cycle Segmentation & Outlier Guard
1. **Bleeding vs. Spotting Differentiation:**
   * Only `flow` values of `"light"`, `"medium"`, or `"heavy"` trigger or extend a menstrual period (`Cycle Day 1`).
   * `"spotting"` is stored in `dailyLogs` without starting a new cycle or resetting the cycle day counter.
   * Consecutive bleeding days (allowing up to a 1-day pause inside an active bleed, i.e., gap $\le 2$ calendar days) merge into a single period block (`startDate` to `endDate`).
   * Historical cycles imported without daily flow entries are preserved and merged cleanly without duplication.
2. **Outlier Filtering:**
   * Cycle length $L_i$ is computed as the day difference between $\text{startDate}_i$ and $\text{startDate}_{i+1}$.
   * Compute the median cycle length across historical cycles.
   * Any cycle where $L_i < 21$, $L_i > 40$, or $|L_i - \text{median}| > 7$ is flagged `isOutlier = true` and excluded from baseline calculations (unless all historical cycles are outliers, in which case raw lengths serve as fallback).

#### Stage 2: Exponentially Weighted Moving Average (EWMA)
1. Select up to the **6 most recent valid cycles** ($L_1, L_2, \dots, L_n$ ordered newest to oldest).
2. Apply recency decay weights $w = [0.35, 0.25, 0.18, 0.12, 0.06, 0.04]$ (normalized to sum to `1.0` when $n < 6$):
   $$\hat{L}_{\text{raw}} = \frac{\sum_{i=1}^{n} w_i \cdot L_i}{\sum_{i=1}^{n} w_i}$$
3. **Cold-Start Prior Blending:** When $n < 3$, blend the empirical EWMA with `defaultCycleLength` ($L_0 = 28$) using prior weight $\alpha = \frac{3 - n}{4}$:
   $$\hat{L} = \text{round}\big(\alpha \cdot L_0 + (1 - \alpha) \cdot \hat{L}_{\text{raw}}\big)$$
4. Compute `averagePeriodLength` as the rounded mean duration ($\text{endDate} - \text{startDate} + 1$) of up to the last 6 cycles (clamped between 1 and 12 days, defaulting to `settings.defaultPeriodLength`).

#### Stage 3: Backward Luteal Anchoring & Biomarker Overrides
Because the follicular phase varies while an individual's luteal phase remains consistent (typically 12–16 days):
1. **Standard Forecast:**
   $$\text{PredictedNextPeriodStart} = \text{LastPeriodStart} + \hat{L}$$
   $$\text{PredictedOvulation} = \text{PredictedNextPeriodStart} - L_{\text{luteal}}$$
2. **Dynamic Mid-Cycle Biomarker Override:**
   * If a cycle contains a `"positive"` `lhTest`, lock `confirmedOvulationDate` to $\text{logDate} + 1\text{ day}$ (ovulation typically follows the first positive LH surge by ~24 hours).
   * If `"egg_white"` `cervicalMucus` is logged (without a positive LH override), set `confirmedOvulationDate` to that date.
   * When `confirmedOvulationDate` is present in the active cycle, immediately recalculate:
     $$\text{PredictedNextPeriodStart} = \text{ConfirmedOvulationDate} + L_{\text{luteal}}$$
3. **Adaptive Luteal Learning:** Across completed historical cycles that have both a `confirmedOvulationDate` and a subsequent `startDate`, compute the observed luteal length ($\text{nextStartDate} - \text{confirmedOvulationDate}$). Average valid observations (clamped to `10–17` days) to personalize $L_{\text{luteal}}$.

#### Stage 4: Variance-Adaptive Windows, Late State & Calendar Projection
1. **Standard Deviation ($\sigma$):** Compute sample standard deviation across valid historical cycle lengths.
2. **Period Arrival Window:**
   $$\text{Earliest} = \text{PredictedNextPeriodStart} - \max(1, \min(3, \text{round}(\sigma)))$$
   $$\text{Latest} = \text{PredictedNextPeriodStart} + \max(1, \min(3, \text{round}(\sigma)))$$
3. **Variance-Adaptive Fertile Window:**
   * Regular cycles ($\sigma \le 2.0$): $[\text{Ovulation} - 5\text{ days},\ \text{Ovulation} + 1\text{ day}]$.
   * Irregular cycles ($\sigma > 2.0$): Widens pre-ovulation window to $[\text{Ovulation} - (5 + \min(4, \text{round}(\sigma))),\ \text{Ovulation} + 1\text{ day}]$.
4. **Late-Period Handling:** If `today > PredictedNextPeriodStart` and no new bleeding has been logged, set `isLate = true`, calculate `daysLate`, and shift the rolling predicted start date forward (`today + 1 day`).
5. **Pre-Computed `calendarMap` Output:** Return a date-keyed dictionary (`YYYY-MM-DD`) marking historical logged periods, confirmed ovulation dates, projected future periods/fertile windows (next 3 cycles), and daily log/spotting flags for direct consumption by any future UI.

### 5.2 Flo Historical Data Importer (`js/floImporter.js`)
* **Input:** Raw JSON string or parsed object exported from Flo (`Menu > Help > Contact us`).
* **Defensive Extraction:** Searches root or nested containers (`operationalData`, `data`) for cycle arrays (`cycles`, `periods`, `menstrual_cycles`) and daily log arrays (`daily_logs`, `symptoms`, `events`, `logs`).
* **Normalization & Deduplication:** Converts timestamps to local `YYYY-MM-DD` keys, normalizes flow intensities and symptom/mood names to internal enum keys, merges with existing vault records without overwriting user notes, and triggers `rebuildCyclesFromLogs` so the prediction engine calibrates immediately.

---

## 6. Phase 2 Specifications: Cryptography & Local Vault (`js/vaultCrypto.js`)

### 6.1 Key Derivation & Encryption Rules
* **Key Derivation (`PBKDF2`):**
  * Input: User PIN or passphrase (minimum 4 characters) + random 16-byte `salt`.
  * Parameters: `SHA-256`, `310,000` iterations, non-extractable `AES-GCM` 256-bit `CryptoKey`.
* **Authenticated Encryption (`AES-GCM`):**
  * Generates a fresh `crypto.getRandomValues(new Uint8Array(12))` IV on **every** write operation—never reuses an IV with the same key.
* **RAM-Only Session Security:**
  * `activeCryptoKey` and `activeVaultState` remain encapsulated in module-private variables while unlocked.
  * Calling `lockVault()` sets both references to `null` immediately.

### 6.2 Required Module API Contract
`js/vaultCrypto.js` must expose the following asynchronous functions:
* `hasExistingVault()` $\rightarrow$ `Promise<boolean>` (checks `app_meta` for `vault_config`).
* `createVault(pin, initialState?)` $\rightarrow$ Generates salt, derives key, writes verifier + encrypted initial vault to IndexedDB, and unlocks session in RAM.
* `unlockVault(pin)` $\rightarrow$ Derives candidate key from stored salt, decrypts `verifierCiphertext` to validate PIN, decrypts `main_vault` into RAM, and throws an error on wrong PIN.
* `lockVault()` / `isVaultUnlocked()` / `getVaultState()` $\rightarrow$ Manages RAM session lifecycle and returns cloned plaintext snapshots.
* `commitVaultState(updaterFn)` $\rightarrow$ Clones active RAM state, applies mutation function, encrypts with a new 12-byte IV, writes to IndexedDB, and updates RAM state.
* `changeVaultPin(currentPin, newPin)` $\rightarrow$ Verifies current PIN and re-encrypts the vault under a newly derived key and salt.
* `exportEncryptedBackup(backupPassphrase)` $\rightarrow$ Derives a standalone backup key (minimum 6-character passphrase) and returns a portable JSON string (`format: "period-tracker-encrypted-backup"`, `version: 1`, Base64 `salt`, `iv`, and `ciphertext`).
* `importEncryptedBackup(backupJsonString, backupPassphrase)` $\rightarrow$ Decrypts an `.enc.json` backup file and commits it to the active vault.
* `panicWipeVault()` $\rightarrow$ Locks RAM state and deletes `PeriodTrackerVaultDB` via `indexedDB.deleteDatabase()`.

---

## 7. Implementation Checklist & Verification Criteria (Phases 1 & 2)

| Phase | Target Files | Verification & Edge-Case Tests |
| :--- | :--- | :--- |
| **Phase 1: Prediction Engine & Importer** | `js/predictionEngine.js`<br>`js/floImporter.js` | • Regular 28-day cycles produce accurate backward ovulation (`Day 14`) and 6-day fertile window.<br>• Isolated `spotting` entries do not trigger `Cycle Day 1` or reset cycle counters.<br>• An outlier cycle (e.g., 45 days) is flagged `isOutlier: true` and excluded from EWMA baseline.<br>• Logging a `positive` LH test shifts `ovulationDate` and recalculates `nextPeriodStart` dynamically.<br>• Irregular cycles ($\sigma > 2.0$) automatically widen the fertile and arrival windows.<br>• Passing `today` past `nextPeriodStart` triggers `isLate: true` and accurate `daysLate`.<br>• Flo JSON sample imports cleanly without duplicate dates. |
| **Phase 2: Crypto & Local Vault** | `js/vaultCrypto.js` | • `createVault()` writes only `ArrayBuffer` ciphertext and random IVs to IndexedDB (verified in browser DevTools).<br>• `unlockVault()` rejects an incorrect PIN cleanly without corrupting stored data.<br>• `commitVaultState()` generates a distinct 12-byte IV on every save.<br>• `exportEncryptedBackup()` + `importEncryptedBackup()` round-trips vault data accurately and fails on wrong backup passphrase.<br>• `panicWipeVault()` removes IndexedDB database and clears RAM state. |