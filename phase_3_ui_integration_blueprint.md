# Project Blueprint: Phase 3 — Production UI & Mascot Integration

## 1. Scope & Native App Ergonomics
Phase 3 builds the user interface layer on top of the completed **Phase 1** (`predictionEngine.js`, `floImporter.js`) and **Phase 2** (`vaultCrypto.js`) modules. Rather than a scrolling desktop webpage, the interface is engineered as a **mobile-first native app shell**:

* **Primary Design Canvas:** `390 × 844 px` (fluid scaling from `320 px` to `480 px`).
* **Desktop / Laptop Presentation:** Centered `max-width: 430 px` phone container framed on a warm cream backdrop (`#F6EFE0`) with soft ambient elevation so calendar grids and rings never stretch across wide monitors.
* **Dynamic Viewport Height:** Uses `height: 100dvh` with `overflow: hidden` on the root shell so mobile browser address bars never clip the floating bottom navigation dock.
* **Safe-Area Insets:** Applies `padding-top: env(safe-area-inset-top)` and `padding-bottom: env(safe-area-inset-bottom)` for notched phones and home-indicator bars.
* **Native Touch Feel:** Minimum `44 × 44 px` tap targets, `user-select: none` on UI controls, `overscroll-behavior: none` to block rubber-band bounce, and GPU-accelerated (`transform` / `opacity`) 60fps transitions.

---

## 2. Phase 3 File & Asset Additions
```text
Period-Tracker/
├── phase_3_ui_integration_blueprint.md # Production UI & integration specification (this file)
├── index.html                  # App shell: Splash, PIN Gate, 4 main views & Log Drawer
├── css/
│   └── styles.css              # Design tokens, local @font-face, animations & mobile layout
├── js/
│   └── app.js                  # UI state controller, DOM rendering & Phase 1/2 event wiring
└── assets/
    ├── fonts/                  # Local rounded .woff2 fonts (Nunito / Quicksand, zero CDNs)
    └── icons/
        └── pompom/
            ├── pompom_waving.png       # Splash screen welcome mascot
            ├── pompom_sleeping.png     # Menstrual phase mascot
            ├── pompom_energetic.png    # Follicular phase mascot
            ├── pompom_love.png         # Ovulation phase mascot (transparent, cropped top)
            └── pompom_eating.png       # Luteal phase mascot
```

---

## 3. Production Design System (`css/styles.css`)

### 3.1 Local Typography (Privacy-Safe)
* Bundle `Nunito` (weights `500`, `600`, `700`, `800`) locally in `assets/fonts/` via `@font-face` so zero external font requests leak user IP addresses.
* Apply `font-variant-numeric: tabular-nums;` on cycle day counters, countdowns, and calendar date cells so digits align without horizontal jitter.

### 3.2 Semantic Color Tokens (Pompompurin Custard & Cocoa Palette)
Keep the warm **Vanilla Cream** canvas and **Beret Cocoa** typography consistent across every screen, shifting only the cycle ring arcs, soft ring tint, and mascot sprite per phase:

```css
:root {
  /* Core Surfaces & Typography */
  --bg-outer-desktop: #F5EEDB;     /* Soft Custard Backdrop on Desktop */
  --bg-app: #FFFDF5;               /* Warm Vanilla Cream App Canvas */
  --bg-card: #FFFFFF;              /* Pure Whipped White Cards */
  --bg-pill-soft: #FFF6D6;         /* Soft Custard Highlight */
  --border-hairline: rgba(74, 50, 34, 0.08);

  --text-primary: #4A3222;         /* Beret Cocoa Brown */
  --text-secondary: #8C705B;       /* Warm Toffee */
  --accent-custard: #F7D358;       /* Pompompurin Custard Gold */
  --accent-custard-press: #EBC13D; /* Pressed Custard Gold */
  --dock-cocoa: #3B2619;           /* Floating Navigation Dock */

  /* Phase Accent Tokens (Ring Arcs, Ring Tints & Week Pills) */
  --phase-menstrual: #E06D6B;      /* Strawberry Rose */
  --phase-menstrual-tint: #FDECEC;
  --phase-follicular: #F2C138;     /* Custard Gold */
  --phase-follicular-tint: #FFF7D6;
  --phase-fertile: #6BA37C;        /* Matcha Sage */
  --phase-fertile-tint: #EAF5EE;
  --phase-ovulation: #3F7A52;      /* Deep Matcha */
  --phase-ovulation-tint: #E1F2E7;
  --phase-luteal: #E59A59;         /* Caramel Peach */
  --phase-luteal-tint: #FDF2E7;

  /* Elevation & Spring Physics */
  --shadow-card: 0 10px 28px rgba(74, 50, 34, 0.07);
  --shadow-dock: 0 12px 32px rgba(59, 38, 25, 0.24);
  --spring-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);
  --ease-sheet: cubic-bezier(0.22, 1, 0.36, 1);
}
```

### 3.3 Micro-Interaction & Motion Standards
* **Tactile Press Feedback:** All interactive pills, keypad buttons, and day cells scale smoothly on press (`transition: transform 0.18s var(--spring-bounce);` with `:active { transform: scale(0.95); }`).
* **Idle Mascot Breathing:** Inside the hero cycle ring, Pompompurin animates with a subtle 3.2-second vertical float (`translateY(0px)` $\rightarrow$ `translateY(-4px)` $\rightarrow$ `translateY(0px)`).
* **Bottom Sheet Drawer:** Slides up from `translateY(100%)` to `translateY(0)` in `320ms` using `var(--ease-sheet)` over a dimmed backdrop (`rgba(74, 50, 34, 0.35)` with `backdrop-filter: blur(4px)`).

---

## 4. Pompompurin Sprite Integration & Framing Rules

### 4.1 Splash Screen Animation (`pompom_waving.png`)
* **Backdrop:** Full-screen Custard Gold (`#F7D358`) splash overlay covering the app shell on cold launch.
* **Choreography (`1.5s` total duration):**
  1. `0.0s – 0.55s`: `pompom_waving.png` springs upward from `translateY(40px) scale(0.8)` to `translateY(0) scale(1)` using `var(--spring-bounce)`.
  2. `0.55s – 1.15s`: Gentle celebratory head-tilt wiggle (`rotate(-4deg)` $\rightarrow$ `rotate(4deg)` $\rightarrow$ `rotate(0deg)`) accompanied by subtle CSS golden sparkles and app title fade-in.
  3. `1.2s – 1.5s`: Cross-fades (`opacity: 0`) directly into the **PIN Gate**.
* **UX Safeguard:** Tapping anywhere on the splash screen immediately skips the remaining animation and reveals the PIN Gate.

### 4.2 Cycle Ring Mascot Masking (`overflow: hidden`)
The bottom half of the central cycle ring acts as a circular window (`border-radius: 50%; overflow: hidden`) so Pompompurin peeks up from the lower curve of the ring without overflowing the progress arc:

| Cycle Phase (`forecast.currentPhase`) | Sprite File | Framing & CSS Alignment Rules |
| :--- | :--- | :--- |
| **`menstrual`** | `assets/icons/pompom/pompom_sleeping.png` | `width: 76%; object-position: center 75%;` — Scaled slightly smaller so Pompompurin, Muffin, and the blanket cluster fit inside the circle without clipping side characters. |
| **`follicular`** | `assets/icons/pompom/pompom_energetic.png` | `width: 82%; object-position: center 20%;` — Anchors upper body so happy eyes and raised paws peek above the lower arc. |
| **`ovulation`** | `assets/icons/pompom/pompom_love.png` | `width: 80%; object-position: center 25%;` — Requires transparent background (no checkerboard) and top whitespace cropped so heart wand and beret heart stay centered. |
| **`fertile`** | `assets/icons/pompom/pompom_love.png` | Uses the same warm framing as `ovulation` during the pre-ovulation fertile window. |
| **`luteal`** | `assets/icons/pompom/pompom_eating.png` | `width: 82%; object-position: center 30%;` — Keeps both his face and the boba cup visible inside the ring. |

---

## 5. Screen-by-Screen UI Architecture

```text
[1. Custard Splash (~1.5s)] ──► [2. Cocoa PIN Gate] ──► [3. Main App Shell (max 430px)]
                                                          ├── View A: Today Dashboard
                                                          ├── View B: Monthly Calendar
                                                          ├── View C: Cycle Insights
                                                          ├── View D: Vault & Settings
                                                          └── Sheet: Slide-Up Daily Log Drawer
```

### 5.1 Gate Layer: Vault Lock & Onboarding Screen
* **Visual Layout:** Centered Pompompurin beret emblem, title (`"Welcome Back"` or `"Create Your Vault PIN"`), **6 custard-pudding PIN indicators** that bounce and fill with gold as digits are entered, and a custom `3 × 4` circular cocoa-outlined numeric keypad (`1–9`, `Clear`, `0`, `Backspace`).
* **First-Time Onboarding:** Prompts to enter and confirm a 6-digit PIN, optionally set her display nickname (stored inside `vaultState.settings.userName`), and optionally import a historical Flo JSON file right away.
* **Error Feedback:** Incorrect PIN triggers a `350ms` horizontal shake keyframe on the 6 pudding dots and clears the input buffer.
* **Auto-Lock:** Listens to `document.visibilitychange` and an inactivity timer (`autoLockMinutes`) to call `lockVault()` and return to this gate automatically.

### 5.2 View A: Today Dashboard (Primary Home View)
Adapted directly from the mobile dashboard layout:
1. **Top Header (`~56 px`):**
   * Left: Greeting `"Hello, [Name]"` (`22px` ExtraBold) + formatted active date below (`"21st November, 2026"`).
   * Right: Circular Lock/Profile pill button (tapping locks the vault immediately or opens Settings).
2. **7-Day Horizontal Week Strip:**
   * Displays Sunday–Saturday (`S M T W T F S`) date pills around the selected date.
   * Active/Today pill highlights in the current phase accent color with a small `"Today"` badge above the number and a subtle dot beneath dates that have logged entries.
3. **Hero Dual-Arc SVG Cycle Ring (`240 × 240 px`):**
   * **SVG Progress Track:** Base cream ring (`stroke-width: 10px`, `stroke-linecap: round`) overlaid with dynamic colored SVG `<circle>` arcs (`stroke-dasharray` / `stroke-dashoffset`) showing the **Period arc** (Strawberry Rose) and **Fertile Window arc** (Matcha Sage), plus a glowing circular marker dot at the current cycle day position.
   * **Top-Center Ring Typography:** `"Day 14"` (`28px` ExtraBold) + phase subtitle (`"Ovulation Phase"`, `"Follicular Phase"`, `"Luteal Phase"`, or `"Menstrual Phase"` — spelled accurately).
   * **Bottom-Center Mascot Window:** Peeking Pompompurin sprite matching `forecast.currentPhase`.
4. **Legend & Primary Action CTA:**
   * Compact inline legend dots (`● Period phase`  `● Fertile window`).
   * Centered pill button **`"Log Period +"`** (`background: #FFFFFF`, `box-shadow: var(--shadow-card)`). Tapping toggles today's flow (`medium` $\leftrightarrow$ `none`) via `commitVaultState()` with instant visual feedback.
5. **Status Summary Cards (2-Card Stack):**
   * **Card 1 — Conception / Fertility Status:** Displays `"Conception Chance"` on the left and a color-coded pill (`● High` during `fertile`/`ovulation`, `● Low` otherwise) on the right (can be hidden via a toggle in Settings).
   * **Card 2 — Next Period Forecast:** Displays `"Next expected Period starts"` + formatted `forecast.nextPeriodStart` and arrival window (`Window: Dec 12 – Dec 14`), or `"Period is X days late"` when `forecast.isLate` is `true`.

### 5.3 Floating Bottom Navigation Dock
* Fixed at the bottom of the app shell (`bottom: calc(16px + env(safe-area-inset-bottom))`), split into two floating elements:
  * **Left Pill Dock (`background: var(--dock-cocoa)`):** Contains 4 tab buttons (**Home**, **Calendar**, **Insights**, **Settings**). The active tab expands into a rounded Custard Gold (`#F7D358`) pill with Cocoa text and icon.
  * **Right Circular Quick-Add Button (`52 × 52 px`, `background: var(--dock-cocoa)`):** White `+` icon that opens the **Daily Log Drawer** for the currently selected date.

### 5.4 View B: Monthly Calendar
* Month switcher header (`< November 2026 >`) with a `"Today"` jump button.
* 7-column grid where each `44 × 44 px` day cell styles automatically from `forecast.calendarMap[YYYY-MM-DD]`:
  * `logged_period`: Solid Strawberry Rose pill (`#E06D6B`) with white text.
  * `predicted_period`: Soft Blush fill (`#FDECEC`) with dashed `#E06D6B` border.
  * `fertile`: Soft Mint fill (`#EAF5EE`) with Matcha Sage text.
  * `ovulation`: Deep Matcha ring (`#3F7A52`) with a tiny gold star indicator.
  * `hasLog`: Small cocoa indicator dot at the bottom of the cell.
* Tapping any date opens the **Slide-Up Daily Log Drawer** for that date.

### 5.5 View C: Cycle Insights
* **4 Summary Metric Cards (`2 × 2` Grid):** Average Cycle Length (`days`), Average Period Duration (`days`), Cycle Regularity (`±σ days`), and Personal Luteal Length (`days`).
* **Recent Cycles Bar Chart:** Clean CSS/SVG horizontal bar list of her last 6 cycles showing start dates, cycle lengths, and an `"Outlier"` badge on any cycle flagged `isOutlier: true`.
* **Top Symptoms Summary:** Ranked horizontal progress pills showing her most frequently logged symptoms.

### 5.6 View D: Vault & Settings
* **Personalization:** Edit display name (`"Hello, [Name]"`) and toggle visibility of the `"Conception Chance"` dashboard card.
* **Cycle Baselines:** Numeric steppers for `defaultCycleLength`, `defaultPeriodLength`, `lutealPhaseLength`, and `autoLockMinutes`.
* **Data & Migration:**
  * **Import Flo History (`.json`):** File picker wired to `importFloData()`.
  * **Export Encrypted Backup (`.enc.json`):** Prompts for a backup passphrase and triggers a file download via `exportEncryptedBackup()`.
  * **Import Encrypted Backup (`.enc.json`):** File picker + passphrase modal wired to `importEncryptedBackup()`.
* **Security Controls:** **Change PIN** (`changeVaultPin()`) and **Panic Wipe** (two-step confirmation modal calling `panicWipeVault()`).

### 5.7 Contextual Overlay: Slide-Up Daily Log Drawer
* Opens when tapping `+` in the dock or tapping any date cell in the Calendar / Week Strip.
* **Header:** Selected date label + `"Close"` button.
* **Controls (All single-tap, zero typing required unless adding a note):**
  1. **Flow Intensity:** Segmented pill bar (`None` | `Spotting` | `Light` | `Medium` | `Heavy`).
  2. **Symptoms (Multi-Select Chips):** `Cramps`, `Bloating`, `Headache`, `Fatigue`, `Tender Breasts`, `Acne`, `Backache`, `Nausea`.
  3. **Mood (Single-Select Pills):** `Calm`, `Happy`, `Sensitive`, `Irritable`, `Low Energy`.
  4. **Biomarkers (Collapsible Section):** `LH Test` (`Negative` / `Positive`), `Cervical Mucus` (`Dry` / `Sticky` / `Creamy` / `Egg-White` → `'egg_white'`), and `BBT` numeric input.
  5. **Private Note:** Single-line/auto-growing textarea encrypted inside `dailyLogs[date].note`.
* **Footer CTA:** Full-width Custard Gold **`"Save Entry"`** button that calls `commitVaultState()`, re-runs `runPredictionEngine()`, updates the UI, and closes the drawer.

---

## 6. Phase 1 & Phase 2 Integration Contracts (`js/app.js`)

`js/app.js` acts strictly as the presentation controller and communicates with the Phase 1/2 modules through these exact contracts:

| UI Action | Module Call | State & UI Effect |
| :--- | :--- | :--- |
| **App Boot** | `await hasExistingVault()` | If `false`, show Create PIN onboarding; if `true`, show Unlock PIN keypad after splash fades. |
| **PIN Submit (New)** | `await createVault(pin, initialState)` | Creates encrypted IndexedDB vault, unlocks RAM session, runs `renderApp()`. |
| **PIN Submit (Unlock)** | `await unlockVault(pin)` | Decrypts vault into RAM; on throw, triggers PIN shake animation; on success, runs `renderApp()`. |
| **Render / Refresh** | `const forecast = runPredictionEngine(getVaultState(), todayStr)` | Updates Today ring arcs, active Pompompurin sprite, countdown cards, Calendar grid, and Insights metrics. |
| **Save Daily Log / Toggle Period** | `await commitVaultState((draft) => { ... })` | Mutates `draft.dailyLogs[date]` or `draft.settings`, re-encrypts with a fresh 12-byte IV, writes to IndexedDB, and re-runs `runPredictionEngine()`. |
| **Import Flo File** | `const { vaultState, summary } = importFloData(jsonText, getVaultState())` | Commits merged `vaultState` via `commitVaultState(() => vaultState)` and displays imported cycle/log count toast. |
| **Export Backup** | `const blobStr = await exportEncryptedBackup(passphrase)` | Creates a `Blob` (`application/json`) and triggers browser download of `purin-backup-YYYY-MM-DD.enc.json`. |
| **Import Backup** | `await importEncryptedBackup(fileText, passphrase)` | Decrypts `.enc.json` backup, overwrites vault via `commitVaultState()`, and refreshes forecast. |
| **Auto-Lock / Lock Button** | `lockVault()` | Wipes `activeCryptoKey` and `activeVaultState` from RAM and switches DOM back to the PIN Gate. |
| **Panic Wipe** | `await panicWipeVault()` | Deletes `PeriodTrackerVaultDB` completely and resets UI to first-time onboarding. |

---

## 7. Recommended 3-Step Build Sequence

1. **Step 3.1 — Design System, Splash & App Shell (`index.html`, `css/styles.css`):**
   Build the `430 px` desktop frame, `100dvh` safe-area layout, `@font-face` declarations, CSS tokens, Custard Splash animation (`pompom_waving.png`), PIN keypad screen, and floating cocoa dock.
2. **Step 3.2 — Vault Gate & Today Dashboard (`js/app.js`):**
   Wire `vaultCrypto.js` and `predictionEngine.js` to unlock the vault, render the 7-day week strip, animate the dual-arc SVG cycle ring with dynamic Pompompurin phase sprites, and enable one-tap `"Log Period +"`.
3. **Step 3.3 — Calendar Grid, Slide-Up Log Drawer, Insights & Backups:**
   Complete the interactive monthly calendar, bottom-sheet log drawer, cycle insights cards, Flo JSON importer, and encrypted `.enc.json` backup flows.