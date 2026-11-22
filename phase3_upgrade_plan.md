# Phase 3 Upgrade Plan: Clue-Inspired Continuous Calendar, Bento Hierarchy & Tactile Pompompurin UI

## 1. Files to Modify
* `index.html` — Update the Cycle (Home) view structure, replace paginated month headers with a continuous vertical scroll container and sticky weekday bar, and refine the bottom dock + slide-up log drawer markup.
* `css/styles.css` — Implement tight Bento spacing (eliminating dead vertical whitespace), Clue-inspired crisp grid geometry, sticky headers, GPU-accelerated spring micro-interactions, and Pompompurin ring framing.
* `js/app.js` — Replace single-month pagination (`prevMonth`/`nextMonth` buttons) with a continuous multi-month calendar renderer, IntersectionObserver month tracking, auto-scroll to Today, and tactile state transitions wired to `predictionEngine.js` and `vaultCrypto.js`.

*(Do NOT modify `js/predictionEngine.js`, `js/floImporter.js`, or `js/vaultCrypto.js`.)*

---

## 2. Core Design Mandates & Constraints
1. **Zero AI Elements or Generic Stock Icons:**
   * Do NOT use AI-generated icons, generic decorative sparkles, robot/magic-wand motifs, or stock clipart.
   * All character visuals must come exclusively from the 5 local Pompompurin assets in `assets/pompom/` (`pompom_waving.png`, `pompom_sleeping.png`, `pompom_energetic.png`, `pompom_love.png`, `pompom_eating.png`).
   * All UI icons (navigation tabs, lock icon, filter/drop icon, plus trigger) must be minimal, uniform `1.75px`-stroke geometric SVGs with rounded linecaps matching Pompompurin's thick cocoa outline style (`#4A3222`).
2. **Aesthetic & Emotional Impact:**
   * Combine **Clue's clean, structured, high-clarity tracking layout** with **Pompompurin's cozy Custard (`#F7D358`), Vanilla Cream (`#FFFDF5`), and Beret Cocoa (`#4A3222`) palette**.
   * Every tap must feel physically responsive using spring curves (`cubic-bezier(0.34, 1.56, 0.64, 1)`) and active scale compression—never static or stiff.

---

## 3. Upgrade 1: Clue-Style Continuous Vertical Scrolling Calendar (`Calendar` Tab)

Replace the current single-month card and `<` / `>` arrow buttons with Clue's continuous vertical scrolling month feed:

1. **Fixed Top Header & Sticky Weekday Strip:**
   * **Top Bar (`48px` height):** Left-aligned active month/year indicator (updates dynamically as the user scrolls, e.g., `November 2026`), right-aligned `"Today"` jump pill button (smooth-scrolls back to today's cell).
   * **Sticky Weekday Header (`32px` height):** `S M T W T F S` pinned directly beneath the top bar (`position: sticky; top: 0; z-index: 10; background: #FFFDF5`) with a subtle `1px solid rgba(74, 50, 34, 0.08)` bottom divider so day columns stay aligned while scrolling across months.
2. **Continuous Multi-Month Scroll Feed:**
   * Render a continuous vertical list of months spanning **6 months past through 4 months future** (11 months total) inside the scrollable viewport (`overflow-y: auto; scroll-behavior: smooth`).
   * Each month block starts with a clean, centered or left-aligned **Month Divider Label** (`October 2026`, `November 2026`, `December 2026`) followed immediately by its 7-column day grid—no enclosed outer white box wasting horizontal margin.
3. **Clue-Inspired Grid Cells & Selection Ring:**
   * Use crisp, tightly gapped (`3px` gap) rounded-square cells (`border-radius: 10px`, minimum `44px` height) across the full container width (`padding: 0 12px`).
   * **Phase Styling (driven by `forecast.calendarMap[YYYY-MM-DD]`):**
     * `logged_period`: Solid Terracotta fill (`#D96B66`) with crisp white date text.
     * `predicted_period`: Soft Blush fill (`#FBE1DF`) with dashed `1.5px` `#D96B66` border and `#7A2E2C` text.
     * `fertile`: Matcha Mint fill (`#E3F2E8`) with high-contrast `#2F6340` text.
     * `ovulation`: Deep Matcha fill (`#4A7856`) with white bold text and a tiny custard-gold dot (`#F7D358`) below the number.
     * `hasLog` (symptoms/mood/BBT/LH): Small `4px` cocoa or gold indicator dot pinned near the bottom edge of the cell.
   * **Selected Date Frame (Clue Signature):** Tapping any cell applies a bold `2.5px solid #4A3222` (or custard-cocoa double ring) outline around that square with a spring pop (`scale(1.06)` settling to `1.0`) and opens/updates a compact **Docked Day Summary Bar** pinned just above the bottom tab bar (showing the date's cycle day, phase, logged tags, and an `"Edit Log"` button).
   * **Auto-Scroll on Open:** When switching to the `Calendar` tab, automatically scroll so the current week sits comfortably in the upper-middle third of the viewport.

---

## 4. Upgrade 2: Tight Bento Hierarchy & Clue-Inspired `Cycle` (Home) Tab

Eliminate wasted vertical whitespace so all key information fits cleanly inside `390 × 844 px` without awkward empty gaps:

1. **Compact Header + Bento Cycle Strip (`Top Zone`):**
   * **Header (`44px`):** `"Hello, Min Claire"` on the left, date subtitle (`22nd November, 2026`), and the quick-lock vault button on the top right.
   * **3-Card Bento Metric Row (Inspired by Clue's top summary blocks):** Directly under the header (or below the 7-day week strip), display three compact, equal-width custard-tinted cards (`gap: 8px`, `border-radius: 14px`, `padding: 10px 8px`):
     * **Card 1:** `Cycle Day` -> e.g., **Day 1**
     * **Card 2:** `Next Period` -> e.g., **Dec 20** (`in 28d`)
     * **Card 3:** `Conception` -> e.g., **Low** (or **High** during fertile window)
   * This replaces the tall, spaced-out bottom cards and eliminates vertical bloat.
2. **Hero Dual-Arc SVG Cycle Ring + Anchored Pompompurin:**
   * Size the hero SVG ring to `248px × 248px` with a `14px` stroke width so it commands visual hierarchy without pushing controls off-screen.
   * **Full Expected Period Arc:** Draw the entire expected period span (`averagePeriodLength`)—solid `#D96B66` for logged bleeding days and soft `#F3B8B5` for remaining predicted days—plus the `#6BA37C` fertile arc and `#3F7A52` ovulation marker dot.
   * **Character Framing:** Anchor the active phase sprite (`~138px` wide) cleanly into the lower curve of the inner circle (`overflow: hidden`) so Pompompurin looks integrated into the ring rather than floating in empty space.
   * **Primary Action Pill:** Place `"Log Period +"` (solid `#D96B66` when unlogged) / `"Period Logged ✓"` (soft `#FDECEC` tinted pill with `#E06D6B` border when logged) right below the ring (`margin-top: 12px`).

---

## 5. Upgrade 3: Tactile Interactivity & 60fps Motion System

Make the interface feel alive and tactile on every interaction using GPU-only `transform` and `opacity` transitions:

1. **Spring Button & Chip Physics:**
   * All interactive controls (`.btn`, `.day-cell`, `.week-pill`, `.chip`, `.nav-item`, `.fab-plus`) use:
     ```css
     transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1), background-color 0.18s ease, box-shadow 0.18s ease;
     ```
   * On `:active`, compress to `transform: scale(0.93)` so every tap has physical weight.
2. **Sliding Pill Tab Indicator (Bottom Dock):**
   * Instead of the active yellow pill abruptly jumping between `Home`, `Calendar`, `Insights`, and `Settings`, animate the active tab pill smoothly and bounce the tab icon (`translateY(-2px) scale(1.08)`) when selected.
3. **Interactive Hero Ring & Pompompurin Touch Reaction:**
   * Tapping Pompompurin inside the cycle ring triggers a playful rubbery squish-and-bounce keyframe (`scaleX(1.08) scaleY(0.92)` -> `scaleX(0.96) scaleY(1.04)` -> `scale(1)`) and cycles a short, comforting phase status note below the phase title.
4. **Slide-Up Daily Log Drawer Physics:**
   * The `+` quick-log button rotates `45deg` on press and slides the Daily Log bottom sheet upward (`cubic-bezier(0.22, 1, 0.36, 1)`) with a dimmed backdrop (`rgba(74, 50, 34, 0.35)`).
   * Tapping flow pills or symptom chips triggers an immediate spring pop (`scale(1.05)` -> `1.0`) and updates the UI state optimistically before committing encrypted data to IndexedDB.

---

## 6. Execution Sequence for Antigravity
* **Pass 1 (`Calendar` Continuous Scroll & Docked Summary):** Implement the continuous multi-month vertical scroll feed, sticky `S M T W T F S` header, dynamic month title observer, `"Today"` jump button, and Clue-style selected cell frame + docked bottom day card.
* **Pass 2 (`Cycle` Bento Layout & Tactile Animations):** Restructure the Home screen into the tight Bento layout (removing dead whitespace), refine the dual-arc SVG ring + Pompompurin framing, and apply the spring press/bounce animations across all buttons, chips, and navigation tabs.