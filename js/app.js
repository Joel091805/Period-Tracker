/**
 * Purin Cycle — Pompompurin World Tactile UI & Integration Controller (Phase 3)
 * Connects Phase 1 (predictionEngine.js, floImporter.js) and Phase 2 (vaultCrypto.js).
 */

import {
  hasExistingVault,
  createDeviceVault,
  unlockDeviceVault,
  isPinLockEnabled,
  enablePinLock,
  disablePinLock,
  createVault,
  unlockVault,
  lockVault,
  isVaultUnlocked,
  getVaultState,
  commitVaultState,
  changeVaultPin,
  exportEncryptedBackup,
  importEncryptedBackup,
  panicWipeVault,
  PIN_LENGTH,
  MIN_BACKUP_PASSPHRASE_LENGTH,
} from './vaultCrypto.js';

import {
  runPredictionEngine,
  rebuildCyclesFromLogs,
  createEmptyVaultState,
  getTodayIsoDate,
  addDays,
  diffDays,
  parseIsoDate,
  formatIsoDate,
  BLEEDING_FLOWS,
  VALID_FLOWS,
  VALID_SYMPTOMS,
  VALID_MOODS,
  VALID_LH_TESTS,
  VALID_CERVICAL_MUCUS,
} from './predictionEngine.js';

import { importFloData } from './floImporter.js';

/* ==========================================================================
   Constants & Pompompurin Phase Presentation Map
   ========================================================================== */
const SPLASH_FADE_MS = 5000;
const RING_CENTER = 124;
const RING_RADIUS = 108;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
const CALENDAR_MONTHS_PAST = 6;
const CALENDAR_MONTHS_FUTURE = 4;

const PHASE_META = Object.freeze({
  menstrual: {
    label: 'Menstrual Phase',
    sprite: 'assets/icons/pompom/pompom_sleeping.png',
    spriteClass: 'mascot-menstrual',
    notes: [
      (name) => `Cozy blanket mode! Purin brought warm snacks for you, ${name}~`,
      (name) => `Take it nice and slow today, ${name}. Warm tea & naps are mandatory!`,
      (name) => `Purin is keeping your spot warm and cozy, ${name}~`,
    ],
  },
  follicular: {
    label: 'Follicular Phase',
    sprite: 'assets/icons/pompom/pompom_energetic.png',
    spriteClass: 'mascot-follicular',
    notes: [
      (name) => `Fresh custard energy! Ready for a bright day, ${name}?`,
      (name) => `Purin feels a pep in his step today—you've got this, ${name}!`,
      (name) => `Steady, sunny momentum ahead for you, ${name}~`,
    ],
  },
  fertile: {
    label: 'Fertile Window',
    sprite: 'assets/icons/pompom/pompom_love.png',
    spriteClass: 'mascot-fertile',
    notes: [
      (name) => `Peak glow days! Purin is cheering you on, ${name}~`,
      (name) => `Warm & connected energy is high today, ${name}!`,
      (name) => `Stay hydrated and shine bright, ${name}~`,
    ],
  },
  ovulation: {
    label: 'Ovulation Phase',
    sprite: 'assets/icons/pompom/pompom_love.png',
    spriteClass: 'mascot-ovulation',
    notes: [
      (name) => `Ovulation highlight day! You're glowing, ${name}~`,
      (name) => `Peak fertility window—Purin sends extra hugs, ${name}!`,
      (name) => `Highest energy & sparkle of the cycle, ${name}~`,
    ],
  },
  luteal: {
    label: 'Luteal Phase',
    sprite: 'assets/icons/pompom/pompom_eating.png',
    spriteClass: 'mascot-luteal',
    notes: [
      (name) => `Pudding & snack break time! Pace yourself gently, ${name}~`,
      (name) => `Cozy wind-down days ahead—Purin saved you a treat, ${name}!`,
      (name) => `Extra rest feels extra good right now, ${name}~`,
    ],
  },
  late: {
    label: 'Period Late',
    sprite: 'assets/icons/pompom/pompom_eating.png',
    spriteClass: 'mascot-luteal',
    notes: [
      (name) => `Cycles shift naturally—Purin is right here with you, ${name}~`,
      (name) => `Rest & deep breaths, ${name}. Log whenever flow begins!`,
      (name) => `Sleep and stress can nudge timing—no worries, ${name}~`,
    ],
  },
  unknown: {
    label: 'Ready to Track',
    sprite: 'assets/icons/pompom/pompom_energetic.png',
    spriteClass: 'mascot-follicular',
    notes: [
      (name) => `Welcome to Purin's cozy vault, ${name}! Log a period to start~`,
      (name) => `Everything stays private & encrypted on your device, ${name}!`,
      (name) => `Tap Purin anytime for a cozy check-in, ${name}~`,
    ],
  },
});

const QUICK_CHIP_REACTIONS = Object.freeze({
  cramps: (name) => `Oh no, cramps! Purin brought a warm heating pad for you, ${name}~`,
  sweet_cravings: (name) => `Sweet cravings? Let's share a caramel custard pudding, ${name}~`,
  sleepy: (name) => `Sleepy vibes today! Curl up for a cozy nap with Purin, ${name}~`,
  happy: (name) => `Yay! Seeing you happy makes Purin's ears wiggle, ${name}~`,
});

const FLOW_LABELS = Object.freeze({
  none: 'No Flow',
  spotting: 'Spotting',
  light: 'Light Flow',
  medium: 'Medium Flow',
  heavy: 'Heavy Flow',
});

const MOOD_LABELS = Object.freeze({
  calm: 'Calm',
  happy: 'Happy',
  sensitive: 'Sensitive',
  irritable: 'Irritable',
  low_energy: 'Low Energy',
});

const SYMPTOM_LABELS = Object.freeze({
  cramps: 'Cramps',
  bloating: 'Bloating',
  headache: 'Headache',
  fatigue: 'Sleepy',
  sweet_cravings: 'Sweet Cravings',
  tender_breasts: 'Tender Breasts',
  acne: 'Acne',
  backache: 'Backache',
  nausea: 'Nausea',
});

const SETTING_LIMITS = Object.freeze({
  defaultCycleLength: { min: 15, max: 90 },
  defaultPeriodLength: { min: 1, max: 12 },
  lutealPhaseLength: { min: 10, max: 17 },
  autoLockMinutes: { min: 1, max: 60 },
});

const WEEKDAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTH_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/* ==========================================================================
   DOM References
   ========================================================================== */
const dom = {
  appShell: document.getElementById('app-shell'),
  splash: document.getElementById('splash-screen'),

  // PIN Gate
  pinGate: document.getElementById('pin-gate'),
  pinTitle: document.getElementById('pin-title'),
  pinSubtitle: document.getElementById('pin-subtitle'),
  onboardingExtras: document.getElementById('onboarding-extras'),
  onboardingName: document.getElementById('onboarding-name'),
  btnOnboardingFlo: document.getElementById('btn-onboarding-flo'),
  onboardingFloStatus: document.getElementById('onboarding-flo-status'),
  fileOnboardingFlo: document.getElementById('file-onboarding-flo'),
  pinDots: document.getElementById('pin-dots'),
  pinError: document.getElementById('pin-error'),
  pinKeypad: document.getElementById('pin-keypad'),

  // Main Shell & Dock
  appMain: document.getElementById('app-main'),
  lockButtons: Array.from(document.querySelectorAll('#btn-lock-vault, [data-action="lock-vault"]')),
  dockPill: document.getElementById('dock-pill'),
  dockIndicator: document.getElementById('dock-indicator'),
  dockTabs: Array.from(document.querySelectorAll('.dock-tab')),
  views: Array.from(document.querySelectorAll('.app-view')),
  btnQuickLog: document.getElementById('btn-quick-log'),

  // Home (Cycle) Dashboard
  greetingTitle: document.getElementById('greeting-title'),
  greetingDate: document.getElementById('greeting-date'),
  weekStrip: document.getElementById('week-strip'),
  bentoRow: document.getElementById('bento-row'),
  bentoOvulationVal: document.getElementById('bento-ovulation-val'),
  bentoOvulationSub: document.getElementById('bento-ovulation-sub'),
  bentoNextLabel: document.getElementById('bento-next-label'),
  bentoNextPeriodVal: document.getElementById('bento-next-period-val'),
  bentoNextPeriodSub: document.getElementById('bento-next-period-sub'),
  cardConception: document.getElementById('card-conception'),
  conceptionPill: document.getElementById('conception-pill'),
  conceptionLabel: document.getElementById('conception-label'),
  conceptionSub: document.getElementById('conception-sub'),
  purinSpeechBubble: document.getElementById('purin-speech-bubble'),
  purinSpeechText: document.getElementById('purin-speech-text'),
  ringArcPeriodExpected: document.getElementById('ring-arc-period-expected'),
  ringArcPeriod: document.getElementById('ring-arc-period'),
  ringArcFertile: document.getElementById('ring-arc-fertile'),
  ringOvulationDot: document.getElementById('ring-ovulation-dot'),
  ringMarker: document.getElementById('ring-marker'),
  cycleDayLabel: document.getElementById('cycle-day-label'),
  cyclePhaseLabel: document.getElementById('cycle-phase-label'),
  btnMascotTap: document.getElementById('btn-mascot-tap'),
  cycleMascotImg: document.getElementById('cycle-mascot-img'),
  btnLogPeriod: document.getElementById('btn-log-period'),
  btnLogPeriodLabel: document.getElementById('btn-log-period-label'),

  // Continuous Calendar
  calActiveMonth: document.getElementById('cal-active-month'),
  calHeaderSubtitle: document.getElementById('cal-header-subtitle'),
  calScrollFeed: document.getElementById('cal-scroll-feed'),
  calMonthsList: document.getElementById('cal-months-list'),
  btnCalToday: document.getElementById('btn-cal-today'),

  // Insights
  insightsHeaderSubtitle: document.getElementById('insights-header-subtitle'),
  insightsHeaderPill: document.getElementById('insights-header-pill'),
  metricAvgCycle: document.getElementById('metric-avg-cycle'),
  metricAvgPeriod: document.getElementById('metric-avg-period'),
  metricAvgPeriodSub: document.getElementById('metric-avg-period-sub'),
  metricRegularity: document.getElementById('metric-regularity'),
  metricRegularitySub: document.getElementById('metric-regularity-sub'),
  metricLuteal: document.getElementById('metric-luteal'),
  insightsCyclesList: document.getElementById('insights-cycles-list'),
  insightsSymptomsList: document.getElementById('insights-symptoms-list'),
  rhythmTotalDays: document.getElementById('rhythm-total-days'),
  rhythmSegMenstrual: document.getElementById('rhythm-seg-menstrual'),
  rhythmSegFollicular: document.getElementById('rhythm-seg-follicular'),
  rhythmSegOvulation: document.getElementById('rhythm-seg-ovulation'),
  rhythmSegLuteal: document.getElementById('rhythm-seg-luteal'),
  rhythmDaysMenstrual: document.getElementById('rhythm-days-menstrual'),
  rhythmDaysFollicular: document.getElementById('rhythm-days-follicular'),
  rhythmDaysOvulation: document.getElementById('rhythm-days-ovulation'),
  rhythmDaysLuteal: document.getElementById('rhythm-days-luteal'),

  // Settings
  settingName: document.getElementById('setting-name'),
  settingShowConception: document.getElementById('setting-show-conception'),
  rowAutoLock: document.getElementById('row-auto-lock'),
  settingPinLock: document.getElementById('setting-pin-lock'),
  btnImportFlo: document.getElementById('btn-import-flo'),
  fileImportFlo: document.getElementById('file-import-flo'),
  btnExportBackup: document.getElementById('btn-export-backup'),
  btnImportBackup: document.getElementById('btn-import-backup'),
  fileImportBackup: document.getElementById('file-import-backup'),
  btnChangePin: document.getElementById('btn-change-pin'),
  btnPanicWipe: document.getElementById('btn-panic-wipe'),
  pwaOfflineBadge: document.getElementById('pwa-offline-badge'),

  // Drawer
  drawerBackdrop: document.getElementById('log-drawer-backdrop'),
  logDrawer: document.getElementById('log-drawer'),
  drawerDateTitle: document.getElementById('drawer-date-title'),
  drawerCycleSubtitle: document.getElementById('drawer-cycle-subtitle'),
  drawerCameoFrame: document.getElementById('drawer-cameo-frame'),
  drawerPurinCameo: document.getElementById('drawer-purin-cameo'),
  btnCloseDrawer: document.getElementById('btn-close-drawer'),
  btnSaveLog: document.getElementById('btn-save-log'),
  drawerFlowGroup: document.getElementById('drawer-flow-group'),
  drawerSymptomsGroup: document.getElementById('drawer-symptoms-group'),
  drawerMoodGroup: document.getElementById('drawer-mood-group'),
  drawerNote: document.getElementById('drawer-note'),

  // Modal & Toast
  modalBackdrop: document.getElementById('app-modal-backdrop'),
  modalTitle: document.getElementById('modal-title'),
  modalDesc: document.getElementById('modal-desc'),
  modalFields: document.getElementById('modal-fields'),
  modalError: document.getElementById('modal-error'),
  btnModalCancel: document.getElementById('btn-modal-cancel'),
  btnModalConfirm: document.getElementById('btn-modal-confirm'),
  toast: document.getElementById('app-toast'),
};

/* ==========================================================================
   Runtime UI State
   ========================================================================== */
const uiState = {
  splashDismissed: false,
  splashTimers: [],

  // Vault / PIN gate state
  vaultExists: false,
  onboardingStep: 'create', // 'create' | 'confirm'
  firstPinAttempt: '',
  stagedFloJson: null,
  pinBuffer: '',
  pinBusy: false,

  // Active app view & date state
  activeTab: 'today',
  selectedDate: getTodayIsoDate(),
  calendarSelectedDate: getTodayIsoDate(),
  calendarObserver: null,
  calendarScrollRaf: null,
  latestForecast: null,
  phaseNoteIndex: 0,
  lastRenderedPhase: null,
  speechOverrideKey: null,

  // Drawer & modal state
  drawerOpen: false,
  drawerDate: getTodayIsoDate(),
  modalConfirmHandler: null,

  // Timers
  toastTimer: null,
  inactivityTimer: null,
  hiddenAt: null,
};

/* ==========================================================================
   Date, Cycle & Jelly Physics Helpers
   ========================================================================== */
function getOrdinalSuffix(day) {
  if (day >= 11 && day <= 13) return 'th';
  switch (day % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function formatLongDate(isoDate) {
  const d = parseIsoDate(isoDate);
  const day = d.getDate();
  return `${day}${getOrdinalSuffix(day)} ${MONTH_NAMES[d.getMonth()]}, ${d.getFullYear()}`;
}

function formatShortDate(isoDate) {
  const d = parseIsoDate(isoDate);
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function formatShortDateWithYear(isoDate) {
  const d = parseIsoDate(isoDate);
  return `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * Computes the completed cycle length for cycles[index], or null if ongoing.
 */
function getCycleLength(cycles, index) {
  if (!Array.isArray(cycles) || index < 0 || index >= cycles.length - 1) {
    return null;
  }
  return diffDays(cycles[index].startDate, cycles[index + 1].startDate);
}

function triggerJellyPop(el, className = 'is-jelly') {
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
}

function getDisplayName(vaultState) {
  const raw = (vaultState?.settings?.userName || '').trim().replace(/!+$/, '').trim();
  return raw || 'Friend';
}

function showToast(message) {
  clearTimeout(uiState.toastTimer);
  dom.toast.textContent = message;
  dom.toast.hidden = false;
  uiState.toastTimer = setTimeout(() => {
    dom.toast.hidden = true;
  }, 2600);
}

/* ==========================================================================
   1. Splash Screen (1.5s Choreography + Tap-to-Skip)
   ========================================================================== */
function dismissSplash(immediate = false) {
  if (uiState.splashDismissed) return;
  uiState.splashDismissed = true;
  uiState.splashTimers.forEach((id) => clearTimeout(id));
  uiState.splashTimers = [];

  if (immediate) {
    dom.splash.hidden = true;
    return;
  }

  dom.splash.classList.add('is-fading');
  const removeTimer = setTimeout(() => {
    dom.splash.hidden = true;
  }, 340);
  uiState.splashTimers.push(removeTimer);
}

function initSplash() {
  const finishTimer = setTimeout(() => dismissSplash(true), SPLASH_FADE_MS);
  uiState.splashTimers.push(finishTimer);

  dom.splash.addEventListener('click', () => dismissSplash(true));
  dom.splash.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dismissSplash(true);
    }
  });
}

/* ==========================================================================
   2. Vault Gate, First-Time Onboarding & Custard Pudding PIN Dots
   ========================================================================== */
function configurePinGateUI() {
  uiState.pinBuffer = '';
  renderPinDots(-1);
  dom.pinError.textContent = '';

  if (uiState.vaultExists) {
    dom.pinTitle.textContent = 'Welcome Back';
    dom.pinSubtitle.textContent = 'Enter your 6-digit vault PIN';
    dom.onboardingExtras.hidden = true;
  } else if (uiState.onboardingStep === 'create') {
    dom.pinTitle.textContent = 'Create Your Vault PIN';
    dom.pinSubtitle.textContent = 'Choose a private 6-digit PIN';
    dom.onboardingExtras.hidden = false;
  } else {
    dom.pinTitle.textContent = 'Confirm Your PIN';
    dom.pinSubtitle.textContent = 'Re-enter your 6-digit PIN to finish';
    dom.onboardingExtras.hidden = true;
  }
}

function setPinBusy(isBusy, message = '') {
  uiState.pinBusy = isBusy;
  dom.pinGate.classList.toggle('is-busy', isBusy);
  if (message) {
    dom.pinSubtitle.textContent = message;
  }
}

function renderPinDots(popIndex = -1) {
  const dots = dom.pinDots.querySelectorAll('.pin-dot');
  dots.forEach((dot, idx) => {
    const filled = idx < uiState.pinBuffer.length;
    dot.classList.toggle('is-filled', filled);
    if (!filled) {
      dot.classList.remove('is-jelly');
    } else if (idx === popIndex) {
      triggerJellyPop(dot);
    }
  });
  dom.pinDots.setAttribute(
    'aria-label',
    `${uiState.pinBuffer.length} of ${PIN_LENGTH} digits entered`
  );
}

function triggerPinError(message) {
  dom.pinError.textContent = message;
  dom.pinDots.classList.remove('is-shaking');
  void dom.pinDots.offsetWidth;
  dom.pinDots.classList.add('is-shaking');
  uiState.pinBuffer = '';
  renderPinDots(-1);
}

function handlePinKey(key) {
  if (dom.pinGate.hidden || uiState.pinBusy) return;
  dom.pinError.textContent = '';

  if (key === 'clear') {
    uiState.pinBuffer = '';
    renderPinDots(-1);
    return;
  }

  if (key === 'backspace') {
    uiState.pinBuffer = uiState.pinBuffer.slice(0, -1);
    renderPinDots(-1);
    return;
  }

  if (/^\d$/.test(key) && uiState.pinBuffer.length < PIN_LENGTH) {
    const filledIdx = uiState.pinBuffer.length;
    uiState.pinBuffer += key;
    renderPinDots(filledIdx);

    if (uiState.pinBuffer.length === PIN_LENGTH) {
      const entered = uiState.pinBuffer;
      handlePinSubmit(entered);
    }
  }
}

async function handlePinSubmit(enteredPin) {
  if (uiState.vaultExists) {
    setPinBusy(true, 'Decrypting vault...');
    try {
      await unlockVault(enteredPin);
      uiState.pinBuffer = '';
      renderPinDots(-1);
      setPinBusy(false);
      enterMainApp();
    } catch {
      setPinBusy(false);
      configurePinGateUI();
      triggerPinError('Incorrect PIN. Please try again.');
    }
    return;
  }

  // First-time onboarding flow
  if (uiState.onboardingStep === 'create') {
    uiState.firstPinAttempt = enteredPin;
    uiState.onboardingStep = 'confirm';
    configurePinGateUI();
    return;
  }

  if (enteredPin !== uiState.firstPinAttempt) {
    uiState.firstPinAttempt = '';
    uiState.onboardingStep = 'create';
    configurePinGateUI();
    triggerPinError('PINs did not match. Try again.');
    return;
  }

  setPinBusy(true, 'Creating encrypted vault...');
  try {
    const userName = dom.onboardingName.value.trim();
    let initialState = createEmptyVaultState({
      userName: userName || '',
      showConceptionChance: true,
    });

    if (uiState.stagedFloJson) {
      const { vaultState } = importFloData(uiState.stagedFloJson, initialState);
      initialState = vaultState;
    }

    await createVault(enteredPin, initialState);
    uiState.vaultExists = true;
    uiState.firstPinAttempt = '';
    uiState.stagedFloJson = null;
    uiState.pinBuffer = '';
    renderPinDots(-1);
    setPinBusy(false);
    enterMainApp();
    showToast('Encrypted vault created');
  } catch (err) {
    setPinBusy(false);
    uiState.firstPinAttempt = '';
    uiState.onboardingStep = 'create';
    configurePinGateUI();
    triggerPinError(err.message || 'Could not create vault.');
  }
}

function enterMainApp() {
  const today = getTodayIsoDate();
  uiState.selectedDate = today;
  uiState.calendarSelectedDate = today;
  uiState.phaseNoteIndex = 0;
  uiState.speechOverrideKey = null;

  dom.pinGate.hidden = true;
  dom.appMain.hidden = false;
  switchTab('today');
  renderApp();
  requestAnimationFrame(() => updateDockIndicator(false));
  resetInactivityTimer();
}

function lockToPinGate(showLockedToast = false) {
  if (!isPinLockEnabled()) return;
  clearTimeout(uiState.inactivityTimer);
  uiState.inactivityTimer = null;
  uiState.hiddenAt = null;
  closeLogDrawer(true);
  closeModal();
  lockVault();
  uiState.latestForecast = null;
  dom.appMain.hidden = true;
  dom.pinGate.hidden = false;
  configurePinGateUI();
  if (showLockedToast) {
    showToast('Vault locked');
  }
}

function getAutoLockMinutes() {
  try {
    const state = getVaultState();
    return Math.max(1, Number(state.settings?.autoLockMinutes) || 5);
  } catch {
    return 5;
  }
}

function resetInactivityTimer() {
  clearTimeout(uiState.inactivityTimer);
  uiState.inactivityTimer = null;
  if (!isVaultUnlocked() || !isPinLockEnabled()) return;

  const minutes = getAutoLockMinutes();
  uiState.inactivityTimer = setTimeout(() => {
    if (isVaultUnlocked() && isPinLockEnabled()) {
      lockToPinGate(true);
    }
  }, minutes * 60_000);
}

function initAutoLock() {
  document.addEventListener('visibilitychange', () => {
    if (!isPinLockEnabled() || !isVaultUnlocked()) {
      uiState.hiddenAt = null;
      return;
    }

    if (document.hidden) {
      uiState.hiddenAt = Date.now();
    } else {
      const hiddenAt = uiState.hiddenAt;
      uiState.hiddenAt = null;
      if (hiddenAt !== null) {
        const minutes = getAutoLockMinutes();
        if (Date.now() - hiddenAt >= minutes * 60_000) {
          lockToPinGate(true);
          return;
        }
      }
      resetInactivityTimer();
    }
  });

  ['pointerdown', 'keydown', 'touchstart'].forEach((evt) => {
    document.addEventListener(evt, () => {
      if (isVaultUnlocked() && isPinLockEnabled()) {
        resetInactivityTimer();
      }
    }, { passive: true });
  });
}

function initPinGate() {
  dom.pinKeypad.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    handlePinKey(btn.dataset.key);
  });

  document.addEventListener('keydown', (e) => {
    if (dom.pinGate.hidden || !dom.splash.hidden) return;
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;

    if (/^\d$/.test(e.key)) {
      handlePinKey(e.key);
    } else if (e.key === 'Backspace') {
      handlePinKey('backspace');
    } else if (e.key === 'Escape') {
      handlePinKey('clear');
    }
  });

  dom.btnOnboardingFlo.addEventListener('click', () => {
    dom.fileOnboardingFlo.value = '';
    dom.fileOnboardingFlo.click();
  });

  dom.fileOnboardingFlo.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const { stats } = importFloData(text, createEmptyVaultState());
      uiState.stagedFloJson = text;
      dom.onboardingFloStatus.textContent =
        `Ready: ${stats.importedCycles} cycles, ${stats.importedLogDays} log days`;
      dom.onboardingFloStatus.hidden = false;
    } catch (err) {
      uiState.stagedFloJson = null;
      dom.onboardingFloStatus.hidden = true;
      dom.pinError.textContent = err.message || 'Invalid Flo JSON file.';
    }
  });

  dom.lockButtons.forEach((btn) => {
    btn.addEventListener('click', () => lockToPinGate(true));
  });
}

/* ==========================================================================
   3. Master Render Pipeline
   ========================================================================== */
function renderApp() {
  if (!isVaultUnlocked()) return;
  const vaultState = getVaultState();
  const todayStr = getTodayIsoDate();
  const forecast = runPredictionEngine(vaultState, todayStr);
  uiState.latestForecast = forecast;

  // Update active theme phase on root shell
  dom.appShell.dataset.phase = forecast.currentPhase || 'unknown';

  renderTodayView(vaultState, forecast, todayStr);
  renderCalendarView(vaultState, forecast, todayStr);
  renderInsightsView(vaultState, forecast);
  renderSettingsView(vaultState);
}

function getInsightsPeriodStats(vaultState, forecast) {
  const defaultPeriodLen = Number(vaultState.settings?.defaultPeriodLength) || 5;
  const cycles = forecast.cycles || [];
  const completedCycles = cycles.filter((_, idx) => getCycleLength(cycles, idx) != null);

  if (completedCycles.length === 0) {
    return {
      avgPeriodDays: defaultPeriodLen,
      isDefaultPeriod: true,
      completedCount: 0,
    };
  }

  const totalPeriodDays = completedCycles.reduce(
    (sum, c) => sum + Math.max(1, diffDays(c.startDate, c.endDate) + 1),
    0
  );
  return {
    avgPeriodDays: Math.max(1, Math.round(totalPeriodDays / completedCycles.length)),
    isDefaultPeriod: false,
    completedCount: completedCycles.length,
  };
}

/* ==========================================================================
   4. View A: Home (Cycle) Dashboard — 3-Zone Pompompurin World Layout
   ========================================================================== */
function renderTodayView(vaultState, forecast, todayStr) {
  const name = getDisplayName(vaultState);
  dom.greetingTitle.textContent = `Hello, ${name}!`;
  dom.greetingDate.textContent = formatLongDate(uiState.selectedDate);

  renderWeekStrip(forecast, todayStr);
  renderBentoMetrics(vaultState, forecast, todayStr);
  renderCycleRing(vaultState, forecast, todayStr);
  renderPurinSpeech(vaultState, forecast, todayStr);

  // Primary Action CTA ("Log Period +") reflects today's logged/imported period status
  const isPeriodToday = Boolean(forecast.calendarMap?.[todayStr]?.isLoggedPeriod);
  dom.btnLogPeriod.classList.toggle('is-active', isPeriodToday);
  dom.btnLogPeriodLabel.textContent = isPeriodToday ? 'Period Logged ✓' : 'Log Period +';
}

function renderBentoMetrics(vaultState, forecast, todayStr) {
  // Card 1: Ovulation (formatted date + days away)
  if (!forecast.hasData || !forecast.predictedOvulationDate) {
    dom.bentoOvulationVal.textContent = '—';
    dom.bentoOvulationSub.textContent = 'Log to start';
  } else {
    dom.bentoOvulationVal.textContent = formatShortDate(forecast.predictedOvulationDate);
    const delta = diffDays(todayStr, forecast.predictedOvulationDate);
    if (delta === 0) {
      dom.bentoOvulationSub.textContent = 'Today';
    } else if (delta > 0) {
      dom.bentoOvulationSub.textContent = `in ${delta}d`;
    } else {
      dom.bentoOvulationSub.textContent = `${Math.abs(delta)}d ago`;
    }
  }

  // Card 2: Next Period (formatted date + countdown)
  if (!forecast.hasData) {
    dom.bentoNextLabel.textContent = 'Next Period';
    dom.bentoNextPeriodVal.textContent = '—';
    dom.bentoNextPeriodSub.textContent = 'Log to start';
  } else if (forecast.isLate) {
    dom.bentoNextLabel.textContent = 'Period Late';
    dom.bentoNextPeriodVal.textContent = `${forecast.daysLate}d late`;
    dom.bentoNextPeriodSub.textContent = `Exp ${formatShortDate(forecast.expectedNextPeriodStart)}`;
  } else {
    dom.bentoNextLabel.textContent = 'Next Period';
    dom.bentoNextPeriodVal.textContent = formatShortDate(forecast.predictedNextPeriodStart);
    const daysLeft = forecast.daysUntilNextPeriod;
    dom.bentoNextPeriodSub.textContent =
      daysLeft <= 0 ? 'Expected today' : `in ${daysLeft}d`;
  }

  // Card 3: Fertility (warm companion copy)
  const showConception = vaultState.settings?.showConceptionChance !== false;
  dom.cardConception.hidden = !showConception;
  dom.bentoRow.classList.toggle('bento-row--two', !showConception);

  const isHighConception =
    forecast.currentPhase === 'fertile' || forecast.currentPhase === 'ovulation';
  dom.conceptionPill.classList.toggle('is-high', isHighConception);
  dom.conceptionLabel.textContent = isHighConception ? 'High' : 'Low';
  dom.conceptionSub.textContent = isHighConception ? 'Peak Days' : 'Cozy Days';
}

function renderPurinSpeech(vaultState, forecast, todayStr) {
  const name = getDisplayName(vaultState);
  const phase = forecast.currentPhase || 'unknown';
  const meta = PHASE_META[phase] || PHASE_META.unknown;
  const todayLog = vaultState?.dailyLogs?.[todayStr] || {};
  const syms = Array.isArray(todayLog.symptoms) ? todayLog.symptoms : [];

  if (uiState.lastRenderedPhase !== phase) {
    uiState.lastRenderedPhase = phase;
    uiState.phaseNoteIndex = 0;
  }

  let message = '';
  if (uiState.speechOverrideKey && QUICK_CHIP_REACTIONS[uiState.speechOverrideKey]) {
    message = QUICK_CHIP_REACTIONS[uiState.speechOverrideKey](name);
  } else if (uiState.phaseNoteIndex === 0 && syms.includes('cramps')) {
    message = QUICK_CHIP_REACTIONS.cramps(name);
  } else if (uiState.phaseNoteIndex === 0 && syms.includes('sweet_cravings')) {
    message = QUICK_CHIP_REACTIONS.sweet_cravings(name);
  } else if (uiState.phaseNoteIndex === 0 && syms.includes('fatigue')) {
    message = QUICK_CHIP_REACTIONS.sleepy(name);
  } else if (uiState.phaseNoteIndex === 0 && todayLog.mood === 'happy') {
    message = QUICK_CHIP_REACTIONS.happy(name);
  } else {
    const notes = meta.notes || [];
    const fn = notes[uiState.phaseNoteIndex % notes.length];
    message = typeof fn === 'function' ? fn(name) : '';
  }

  dom.purinSpeechText.textContent = message;
}

function renderWeekStrip(forecast, todayStr) {
  const anchor = parseIsoDate(uiState.selectedDate);
  const startOfWeek = addDays(uiState.selectedDate, -anchor.getDay()); // Sunday
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < 7; i++) {
    const iso = addDays(startOfWeek, i);
    const d = parseIsoDate(iso);
    const entry = forecast.calendarMap[iso];
    const isToday = iso === todayStr;
    const isSelected = iso === uiState.selectedDate;
    const hasActivity = Boolean(entry && (entry.hasLog || entry.isLoggedPeriod));

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'week-pill' + (isSelected ? ' is-selected' : '');
    btn.dataset.date = iso;
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', String(isSelected));
    btn.setAttribute('aria-label', formatLongDate(iso));

    const topLabel = document.createElement('span');
    topLabel.className = isToday ? 'week-pill-today' : '';
    topLabel.textContent = isToday ? 'Today' : WEEKDAY_LETTERS[i];

    const num = document.createElement('span');
    num.className = 'week-pill-num tabular';
    num.textContent = String(d.getDate());

    const dot = document.createElement('span');
    dot.className = 'week-pill-dot' + (hasActivity ? '' : ' week-pill-dot--empty');

    btn.append(topLabel, num, dot);
    fragment.appendChild(btn);
  }

  dom.weekStrip.replaceChildren(fragment);
}

function renderCycleRing(vaultState, forecast) {
  const phase = forecast.currentPhase || 'unknown';
  const meta = PHASE_META[phase] || PHASE_META.unknown;

  // Update mascot sprite & framing class
  dom.cycleMascotImg.src = meta.sprite;
  dom.cycleMascotImg.className = `cycle-mascot-img ${meta.spriteClass}`;
  dom.cyclePhaseLabel.textContent = meta.label;

  if (!forecast.hasData || !forecast.currentCycleDay) {
    dom.cycleDayLabel.classList.remove('cycle-day-label--late');
    dom.cycleDayLabel.textContent = 'Day —';
    dom.ringArcPeriodExpected.style.strokeDasharray = `0 ${RING_CIRCUMFERENCE.toFixed(2)}`;
    dom.ringArcPeriod.style.strokeDasharray = `0 ${RING_CIRCUMFERENCE.toFixed(2)}`;
    dom.ringArcFertile.style.strokeDasharray = `0 ${RING_CIRCUMFERENCE.toFixed(2)}`;
    dom.ringOvulationDot.style.opacity = '0';
    dom.ringMarker.style.opacity = '0';
    return;
  }

  const isLateHeadline = Boolean(forecast.isLate && forecast.daysLate > 0);
  dom.cycleDayLabel.classList.toggle('cycle-day-label--late', isLateHeadline);
  if (isLateHeadline) {
    dom.cycleDayLabel.textContent = `${forecast.daysLate} ${forecast.daysLate === 1 ? 'Day' : 'Days'} Late`;
    dom.cyclePhaseLabel.textContent = `Cycle Day ${forecast.currentCycleDay} • Period Late`;
  } else {
    dom.cycleDayLabel.textContent = `Day ${forecast.currentCycleDay}`;
    dom.cyclePhaseLabel.textContent = meta.label;
  }
  dom.ringMarker.style.opacity = '1';

  const cycleLen = Math.max(15, forecast.predictedCycleLength || 28);
  const periodStats = getInsightsPeriodStats(vaultState, forecast);
  const loggedPeriodLen = forecast.activeCycle
    ? Math.max(1, diffDays(forecast.activeCycle.startDate, forecast.activeCycle.endDate) + 1)
    : 0;
  const expectedPeriodLen = Math.min(
    cycleLen,
    Math.max(loggedPeriodLen, forecast.averagePeriodLength || 0, periodStats.avgPeriodDays)
  );

  // Full expected period arc (soft blush #F3B8B5) underneath
  const expectedArcLen = (expectedPeriodLen / cycleLen) * RING_CIRCUMFERENCE;
  dom.ringArcPeriodExpected.style.strokeDasharray = `${expectedArcLen.toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`;
  dom.ringArcPeriodExpected.style.strokeDashoffset = '0';

  // Logged bleeding days arc (solid terracotta #D96B66) on top
  const loggedArcLen = (Math.min(cycleLen, loggedPeriodLen) / cycleLen) * RING_CIRCUMFERENCE;
  dom.ringArcPeriod.style.strokeDasharray = `${loggedArcLen.toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`;
  dom.ringArcPeriod.style.strokeDashoffset = '0';

  // Fertile window arc positioned relative to activeCycle.startDate
  if (forecast.activeCycle && forecast.fertileWindow) {
    const startOffsetDays = Math.max(
      0,
      diffDays(forecast.activeCycle.startDate, forecast.fertileWindow.start)
    );
    const fertileDays = Math.max(
      1,
      diffDays(forecast.fertileWindow.start, forecast.fertileWindow.end) + 1
    );
    const clampedStart = Math.min(cycleLen - 1, startOffsetDays);
    const clampedLen = Math.min(cycleLen - clampedStart, fertileDays);

    const fertileArcLen = (clampedLen / cycleLen) * RING_CIRCUMFERENCE;
    const fertileOffset = -((clampedStart / cycleLen) * RING_CIRCUMFERENCE);

    dom.ringArcFertile.style.strokeDasharray = `${fertileArcLen.toFixed(2)} ${RING_CIRCUMFERENCE.toFixed(2)}`;
    dom.ringArcFertile.style.strokeDashoffset = fertileOffset.toFixed(2);
  } else {
    dom.ringArcFertile.style.strokeDasharray = `0 ${RING_CIRCUMFERENCE.toFixed(2)}`;
  }

  // Distinct dark-matcha ovulation marker dot (#3F7A52) on exact predictedOvulationDate
  if (forecast.activeCycle && forecast.predictedOvulationDate) {
    const ovOffsetDays = diffDays(forecast.activeCycle.startDate, forecast.predictedOvulationDate);
    if (ovOffsetDays >= 0 && ovOffsetDays < cycleLen) {
      const ovAngle = (ovOffsetDays / cycleLen) * 2 * Math.PI;
      const ovCx = RING_CENTER + RING_RADIUS * Math.cos(ovAngle);
      const ovCy = RING_CENTER + RING_RADIUS * Math.sin(ovAngle);
      dom.ringOvulationDot.setAttribute('cx', ovCx.toFixed(2));
      dom.ringOvulationDot.setAttribute('cy', ovCy.toFixed(2));
      dom.ringOvulationDot.style.opacity = '1';
    } else {
      dom.ringOvulationDot.style.opacity = '0';
    }
  } else {
    dom.ringOvulationDot.style.opacity = '0';
  }

  // Pompompurin Beret progress marker positioned at current day angle
  // SVG is rotated -90deg so angle 0 = 12 o'clock; rotate(90) keeps the beret upright
  const progress = Math.min(1, Math.max(0, (forecast.currentCycleDay - 1) / cycleLen));
  const angle = progress * 2 * Math.PI;
  const cx = RING_CENTER + RING_RADIUS * Math.cos(angle);
  const cy = RING_CENTER + RING_RADIUS * Math.sin(angle);
  dom.ringMarker.setAttribute(
    'transform',
    `translate(${cx.toFixed(2)}, ${cy.toFixed(2)}) rotate(90)`
  );
}

function initTodayActions() {
  // Interactive Pompompurin jellyPop + comforting speech bubble cycler
  dom.btnMascotTap.addEventListener('click', () => {
    const phase = uiState.latestForecast?.currentPhase || 'unknown';
    const meta = PHASE_META[phase] || PHASE_META.unknown;
    const notes = meta.notes || [];

    triggerJellyPop(dom.cycleMascotImg);
    triggerJellyPop(dom.purinSpeechBubble);

    uiState.speechOverrideKey = null;
    if (notes.length > 0 && isVaultUnlocked()) {
      uiState.phaseNoteIndex = (uiState.phaseNoteIndex + 1) % notes.length;
      const name = getDisplayName(getVaultState());
      const fn = notes[uiState.phaseNoteIndex];
      dom.purinSpeechText.textContent = typeof fn === 'function' ? fn(name) : '';
    }
  });

  dom.cycleMascotImg.addEventListener('animationend', (e) => {
    if (e.animationName === 'jellyPop') {
      dom.cycleMascotImg.classList.remove('is-jelly');
    }
  });

  dom.weekStrip.addEventListener('click', (e) => {
    const pill = e.target.closest('[data-date]');
    if (!pill) return;
    uiState.selectedDate = pill.dataset.date;
    dom.greetingDate.textContent = formatLongDate(uiState.selectedDate);
    if (uiState.latestForecast) {
      renderWeekStrip(uiState.latestForecast, getTodayIsoDate());
    }
    openLogDrawer(uiState.selectedDate);
  });

  dom.btnLogPeriod.addEventListener('click', async () => {
    if (!isVaultUnlocked() || dom.btnLogPeriod.disabled) return;
    const todayStr = getTodayIsoDate();
    const wasPeriodToday = Boolean(
      uiState.latestForecast?.calendarMap?.[todayStr]?.isLoggedPeriod
    );

    // Optimistic UI update + jellyPop
    const nextLoggedOptimistic = !wasPeriodToday;
    dom.btnLogPeriod.classList.toggle('is-active', nextLoggedOptimistic);
    dom.btnLogPeriodLabel.textContent = nextLoggedOptimistic ? 'Period Logged ✓' : 'Log Period +';
    triggerJellyPop(dom.btnLogPeriod);
    dom.btnLogPeriod.disabled = true;

    try {
      let nowLogged = false;
      await commitVaultState((draft) => {
        const existing = draft.dailyLogs[todayStr] || {};
        const wasBleeding = wasPeriodToday || BLEEDING_FLOWS.has(existing.flow);
        const removedFlowDates = [];
        if (wasBleeding) {
          const next = { ...existing, flow: 'none' };
          if (isLogEmpty(next)) {
            delete draft.dailyLogs[todayStr];
          } else {
            draft.dailyLogs[todayStr] = next;
          }
          removedFlowDates.push(todayStr);
          nowLogged = false;
        } else {
          draft.dailyLogs[todayStr] = { ...existing, flow: 'medium' };
          nowLogged = true;
        }
        draft.cycles = rebuildCyclesFromLogs(draft.dailyLogs, draft.cycles, {
          removedFlowDates,
        });
      });
      uiState.speechOverrideKey = null;
      renderApp();
      showToast(nowLogged ? 'Period logged for today' : 'Period removed for today');
    } catch (err) {
      dom.btnLogPeriod.classList.toggle('is-active', wasPeriodToday);
      dom.btnLogPeriodLabel.textContent = wasPeriodToday ? 'Period Logged ✓' : 'Log Period +';
      showToast(err.message || 'Could not update period');
    } finally {
      dom.btnLogPeriod.disabled = false;
    }
  });
}

/* ==========================================================================
   5. View B: Pompompurin Continuous Vertical Scrolling Calendar
   ========================================================================== */
const SVG_NS = 'http://www.w3.org/2000/svg';

function createTodayBeretSvg() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 22 16');
  svg.setAttribute('class', 'cal-today-beret');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<ellipse cx="11" cy="10.5" rx="10" ry="5" fill="#FFFDF5"/>' +
    '<ellipse cx="11" cy="10.5" rx="8.6" ry="3.8" fill="#4A3222"/>' +
    '<path d="M3.6 9.8C4.8 5.6 7.8 4 11 4C14.2 4 17.2 5.6 18.4 9.8C15.5 11.4 6.5 11.4 3.6 9.8Z" fill="#5D3E2B"/>' +
    '<rect x="9.8" y="1.4" width="2.4" height="3.2" rx="1.2" fill="#4A3222"/>';
  return svg;
}

function createOvulationSparkleSvg() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('class', 'cal-marker-sparkle');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<path d="M6 0.8L7.3 4.7L11.2 6L7.3 7.3L6 11.2L4.7 7.3L0.8 6L4.7 4.7Z" fill="#F7D358"/>';
  return svg;
}

function createPuddingCupSvg() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 14 11');
  svg.setAttribute('class', 'cal-marker-pudding');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<path d="M2.2 9.5L3.4 3.6C3.7 2.2 5.1 1.5 7 1.5C8.9 1.5 10.3 2.2 10.6 3.6L11.8 9.5H2.2Z" fill="#F7D358" stroke="#4A3222" stroke-width="1.3" stroke-linejoin="round"/>' +
    '<path d="M3.4 3.8C3.8 2.2 5.1 1.5 7 1.5C8.9 1.5 10.2 2.2 10.6 3.8C9.6 4.4 8.4 4.1 7 4.4C5.6 4.1 4.4 4.4 3.4 3.8Z" fill="#8C5A32"/>';
  return svg;
}

const ACTIVE_PERIOD_FLOWS = Object.freeze(new Set(['spotting', 'light', 'medium', 'heavy']));

/**
 * Returns true if the day's log or calendar entry has an active period flow
 * (Spotting, Light, Medium, or Heavy). Symptom/mood/note-only logs with flow 'none' return false.
 */
function hasActivePeriodFlow(entry, dailyLog) {
  const rawFlow = dailyLog?.flow ?? entry?.flow ?? null;
  if (typeof rawFlow === 'string') {
    const normalized = rawFlow.trim().toLowerCase();
    if (ACTIVE_PERIOD_FLOWS.has(normalized)) return true;
    if (normalized === 'none' || normalized === '') return false;
  }
  return false;
}

/**
 * Returns true if a calendar cell should render as a solid logged period day.
 * Preserves imported historical multi-day cycles even if a symptom-only log (flow: 'none') exists.
 */
function isLoggedPeriodTile(entry, dailyLog) {
  if (hasActivePeriodFlow(entry, dailyLog)) return true;
  return Boolean(entry?.isLoggedPeriod);
}

/**
 * Computes a concise period span badge for a given month (e.g., "Dec 20–24").
 */
function getMonthPeriodBadge(
  year,
  month,
  daysInMonth,
  calendarMap,
  dailyLogs,
  projectedPeriodDates
) {
  const loggedDays = [];
  const predictedDays = [];

  for (let day = 1; day <= daysInMonth; day++) {
    const iso = formatIsoDate(new Date(year, month, day, 12, 0, 0, 0));
    const entry = calendarMap[iso];
    const dailyLog = dailyLogs?.[iso];
    if (isLoggedPeriodTile(entry, dailyLog)) {
      loggedDays.push(day);
    } else if (entry?.isPredictedPeriod || projectedPeriodDates.has(iso)) {
      predictedDays.push(day);
    }
  }

  const isLogged = loggedDays.length > 0;
  const days = isLogged ? loggedDays : predictedDays;
  if (days.length === 0) return null;

  // Group contiguous day numbers into ranges
  const ranges = [];
  let start = days[0];
  let prev = days[0];
  for (let i = 1; i < days.length; i++) {
    if (days[i] === prev + 1) {
      prev = days[i];
    } else {
      ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
      start = days[i];
      prev = days[i];
    }
  }
  ranges.push(start === prev ? `${start}` : `${start}–${prev}`);

  return {
    text: `${MONTH_SHORT[month]} ${ranges.join(', ')}`,
    isLogged,
  };
}

function renderCalendarView(vaultState, forecast, todayStr) {
  const phaseMeta = PHASE_META[forecast.currentPhase || 'unknown'] || PHASE_META.unknown;
  dom.calHeaderSubtitle.textContent =
    forecast.hasData && forecast.currentCycleDay
      ? `Cycle Day ${forecast.currentCycleDay} • ${phaseMeta.label}`
      : 'Tap any day to log';

  const todayDate = parseIsoDate(todayStr);
  const baseYear = todayDate.getFullYear();
  const baseMonth = todayDate.getMonth();
  const prevScrollTop = dom.calScrollFeed.scrollTop;

  const dailyLogs = vaultState?.dailyLogs || {};

  // Build multi-day projected period dates for both the active period and all future predicted cycles
  const projectedPeriodDates = new Set();
  if (forecast.hasData) {
    const periodStats = getInsightsPeriodStats(vaultState, forecast);
    const avgPeriodLength = Math.max(
      1,
      forecast.averagePeriodLength || 0,
      periodStats.avgPeriodDays || 0
    );

    // 1. Remaining projected days of the currently active period (startDate + 1 .. startDate + avgPeriodLength - 1)
    if (forecast.activeCycle && avgPeriodLength > 1) {
      for (let offset = 1; offset < avgPeriodLength; offset++) {
        const iso = addDays(forecast.activeCycle.startDate, offset);
        if (iso >= todayStr) {
          projectedPeriodDates.add(iso);
        }
      }
    }

    // 2. Full multi-day spans for nextPeriodStart and all subsequent projected cycles
    const projectedStarts =
      Array.isArray(forecast.projectedCycles) && forecast.projectedCycles.length > 0
        ? forecast.projectedCycles.map((c) => c.periodStart).filter(Boolean)
        : forecast.predictedNextPeriodStart
          ? [forecast.predictedNextPeriodStart]
          : [];

    for (const startIso of projectedStarts) {
      for (let offset = 0; offset < avgPeriodLength; offset++) {
        projectedPeriodDates.add(addDays(startIso, offset));
      }
    }
  }

  const fragment = document.createDocumentFragment();

  for (let offset = -CALENDAR_MONTHS_PAST; offset <= CALENDAR_MONTHS_FUTURE; offset++) {
    const monthDate = new Date(baseYear, baseMonth + offset, 1, 12, 0, 0, 0);
    const year = monthDate.getFullYear();
    const month = monthDate.getMonth();
    const monthLabel = `${MONTH_NAMES[month]} ${year}`;
    const firstWeekday = monthDate.getDay(); // 0 = Sun
    const daysInMonth = new Date(year, month + 1, 0, 12, 0, 0, 0).getDate();

    const block = document.createElement('div');
    block.className = 'cal-month-block';
    block.dataset.year = String(year);
    block.dataset.month = String(month);
    block.dataset.label = monthLabel;

    // Sanrio Ledger Month Divider Ribbon
    const divider = document.createElement('div');
    divider.className = 'cal-month-divider';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'cal-month-name';
    nameSpan.textContent = monthLabel;

    const dashLine = document.createElement('span');
    dashLine.className = 'cal-month-dash';
    dashLine.setAttribute('aria-hidden', 'true');

    divider.append(nameSpan, dashLine);

    const periodBadge = getMonthPeriodBadge(
      year,
      month,
      daysInMonth,
      forecast.calendarMap,
      dailyLogs,
      projectedPeriodDates
    );
    if (periodBadge) {
      const badge = document.createElement('span');
      badge.className =
        'cal-month-period-badge' +
        (periodBadge.isLogged ? ' cal-month-period-badge--logged' : '');
      badge.textContent = periodBadge.text;
      divider.appendChild(badge);
    }

    block.appendChild(divider);

    const grid = document.createElement('div');
    grid.className = 'cal-month-grid';

    // Leading weekday alignment spacers
    for (let s = 0; s < firstWeekday; s++) {
      const spacer = document.createElement('div');
      spacer.className = 'cal-spacer';
      spacer.setAttribute('aria-hidden', 'true');
      grid.appendChild(spacer);
    }

    // Actual days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = formatIsoDate(new Date(year, month, day, 12, 0, 0, 0));
      const entry = forecast.calendarMap[iso];
      const isToday = iso === todayStr;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-cell';
      btn.dataset.date = iso;
      btn.setAttribute('aria-label', `${formatLongDate(iso)}, tap to log`);

      const dailyLog = dailyLogs[iso];
      const isOvulation = Boolean(entry && (entry.isConfirmedOvulation || entry.isPredictedOvulation));
      const isLoggedPeriod = isLoggedPeriodTile(entry, dailyLog);
      const isPredictedPeriod =
        !isLoggedPeriod && (Boolean(entry?.isPredictedPeriod) || projectedPeriodDates.has(iso));

      if (isLoggedPeriod) {
        btn.classList.add('cal-cell--logged_period');
      } else if (isOvulation) {
        btn.classList.add('cal-cell--ovulation');
      } else if (isPredictedPeriod) {
        btn.classList.add('cal-cell--predicted_period');
      } else if (entry?.isFertileWindow) {
        btn.classList.add('cal-cell--fertile');
      }

      if (isToday) {
        btn.classList.add('cal-cell--today');
        btn.appendChild(createTodayBeretSvg());
      }

      const num = document.createElement('span');
      num.className = 'cal-cell-num';
      num.textContent = String(day);
      btn.appendChild(num);

      if (isOvulation || entry?.hasLog) {
        const markers = document.createElement('span');
        markers.className = 'cal-cell-markers';
        markers.setAttribute('aria-hidden', 'true');

        if (isOvulation) {
          markers.appendChild(createOvulationSparkleSvg());
        }
        if (entry?.hasLog) {
          markers.appendChild(createPuddingCupSvg());
        }
        btn.appendChild(markers);
      }

      grid.appendChild(btn);
    }

    block.appendChild(grid);
    fragment.appendChild(block);
  }

  dom.calMonthsList.replaceChildren(fragment);

  if (uiState.activeTab === 'calendar' && prevScrollTop > 0) {
    dom.calScrollFeed.scrollTop = prevScrollTop;
  }

  setupCalendarMonthObserver();
  syncActiveMonthLabelFromScroll();
}

function setupCalendarMonthObserver() {
  if (uiState.calendarObserver) {
    uiState.calendarObserver.disconnect();
    uiState.calendarObserver = null;
  }

  if (typeof IntersectionObserver === 'undefined') return;

  const blocks = dom.calMonthsList.querySelectorAll('.cal-month-block');
  if (blocks.length === 0) return;

  uiState.calendarObserver = new IntersectionObserver(
    () => {
      syncActiveMonthLabelFromScroll();
    },
    {
      root: dom.calScrollFeed,
      rootMargin: '-12px 0px -70% 0px',
      threshold: [0, 0.1, 0.25],
    }
  );

  blocks.forEach((block) => uiState.calendarObserver.observe(block));
}

function syncActiveMonthLabelFromScroll() {
  const blocks = dom.calMonthsList.querySelectorAll('.cal-month-block');
  if (blocks.length === 0) return;

  const feedRect = dom.calScrollFeed.getBoundingClientRect();
  if (feedRect.height === 0) {
    const sel = parseIsoDate(uiState.calendarSelectedDate || getTodayIsoDate());
    dom.calActiveMonth.textContent = `${MONTH_NAMES[sel.getMonth()]} ${sel.getFullYear()}`;
    return;
  }

  const stickyLine = feedRect.top + 24;
  let activeLabel = blocks[0].dataset.label;

  for (const block of blocks) {
    const rect = block.getBoundingClientRect();
    if (rect.top <= stickyLine) {
      activeLabel = block.dataset.label;
    } else {
      break;
    }
  }

  if (activeLabel && dom.calActiveMonth.textContent !== activeLabel) {
    dom.calActiveMonth.textContent = activeLabel;
  }
}

function scrollCalendarToDate(isoDate, behavior = 'smooth') {
  const feed = dom.calScrollFeed;
  const cell = dom.calMonthsList.querySelector(`[data-date="${isoDate}"]`);
  if (!feed || !cell) return;

  const feedRect = feed.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  if (feedRect.height === 0) return;

  const cellOffsetInFeed = cellRect.top - feedRect.top + feed.scrollTop;
  const targetScrollTop = Math.max(
    0,
    cellOffsetInFeed - (feedRect.height / 2) + (cellRect.height / 2)
  );

  feed.scrollTo({
    top: targetScrollTop,
    behavior,
  });

  const parsed = parseIsoDate(isoDate);
  dom.calActiveMonth.textContent = `${MONTH_NAMES[parsed.getMonth()]} ${parsed.getFullYear()}`;
}

function initCalendar() {
  dom.calScrollFeed.addEventListener(
    'scroll',
    () => {
      if (uiState.calendarScrollRaf) return;
      uiState.calendarScrollRaf = requestAnimationFrame(() => {
        uiState.calendarScrollRaf = null;
        syncActiveMonthLabelFromScroll();
      });
    },
    { passive: true }
  );

  dom.btnCalToday.addEventListener('click', () => {
    const today = getTodayIsoDate();
    uiState.calendarSelectedDate = today;
    triggerJellyPop(dom.btnCalToday);
    scrollCalendarToDate(today, 'smooth');
    const todayCell = dom.calMonthsList.querySelector(`[data-date="${today}"]`);
    if (todayCell) {
      triggerJellyPop(todayCell);
    }
  });

  // 1-Tap Direct-to-Drawer Workflow
  dom.calMonthsList.addEventListener('click', (e) => {
    const cell = e.target.closest('.cal-cell[data-date]');
    if (!cell || !isVaultUnlocked()) return;
    const iso = cell.dataset.date;
    uiState.calendarSelectedDate = iso;
    triggerJellyPop(cell);
    openLogDrawer(iso);
  });
}

/* ==========================================================================
   6. View C: Cycle Insights + Cycle Rhythm Breakdown Card
   ========================================================================== */
function renderInsightsView(vaultState, forecast) {
  const periodStats = getInsightsPeriodStats(vaultState, forecast);
  const totalLoggedCycles = (forecast.cycles || []).length;

  dom.insightsHeaderSubtitle.textContent =
    totalLoggedCycles > 0
      ? `Based on ${totalLoggedCycles} logged ${totalLoggedCycles === 1 ? 'cycle' : 'cycles'}`
      : 'Your personal cycle rhythm';
  dom.insightsHeaderPill.textContent = `${forecast.predictedCycleLength}d Cycle`;

  dom.metricAvgCycle.textContent = `${forecast.predictedCycleLength}d`;
  dom.metricAvgPeriod.textContent = `${periodStats.avgPeriodDays}d`;
  dom.metricAvgPeriodSub.hidden = !periodStats.isDefaultPeriod;
  dom.metricAvgPeriodSub.textContent = 'Default';

  if (periodStats.completedCount >= 2) {
    dom.metricRegularity.textContent = `±${forecast.cycleLengthStdDev}d`;
    dom.metricRegularitySub.hidden = true;
  } else {
    dom.metricRegularity.textContent = '—';
    dom.metricRegularitySub.hidden = false;
    dom.metricRegularitySub.textContent = 'Need 2+ cycles';
  }

  dom.metricLuteal.textContent = `${forecast.lutealPhaseLength}d`;

  // Recent Cycles Bar Chart (last 6 cycles, newest first)
  const allCycles = forecast.cycles || [];
  const indexedRecent = allCycles
    .map((cycle, index) => ({
      cycle,
      length: getCycleLength(allCycles, index),
    }))
    .slice(-6)
    .reverse();

  if (indexedRecent.length === 0) {
    dom.insightsCyclesList.innerHTML =
      '<p class="empty-hint">No completed cycles recorded yet.</p>';
  } else {
    const maxLen = Math.max(
      35,
      ...indexedRecent.map((item) => item.length || forecast.currentCycleDay || 28)
    );
    const fragment = document.createDocumentFragment();

    indexedRecent.forEach(({ cycle, length }) => {
      const isOngoing = length == null;
      const len = isOngoing
        ? Math.max(1, diffDays(cycle.startDate, forecast.today) + 1)
        : length;
      const pct = Math.min(100, Math.round((len / maxLen) * 100));

      const row = document.createElement('div');
      row.className = 'cycle-bar-row';

      const meta = document.createElement('div');
      meta.className = 'cycle-bar-meta';

      const left = document.createElement('span');
      left.textContent = formatShortDateWithYear(cycle.startDate);
      if (cycle.isOutlier) {
        const badge = document.createElement('span');
        badge.className = 'outlier-badge';
        badge.textContent = 'Outlier';
        left.appendChild(badge);
      } else if (isOngoing) {
        const badge = document.createElement('span');
        badge.className = 'active-badge';
        badge.textContent = 'Current';
        left.appendChild(badge);
      }

      const right = document.createElement('span');
      right.className = 'tabular';
      right.textContent = isOngoing ? `Day ${len}` : `${len} days`;

      meta.append(left, right);

      const track = document.createElement('div');
      track.className = 'cycle-bar-track';

      const fill = document.createElement('div');
      fill.className = 'cycle-bar-fill' + (cycle.isOutlier ? ' cycle-bar-fill--outlier' : '');
      fill.style.width = `${pct}%`;

      track.appendChild(fill);
      row.append(meta, track);
      fragment.appendChild(row);
    });

    dom.insightsCyclesList.replaceChildren(fragment);
  }

  // Top Symptoms Summary (including quick-checkin Sweet Cravings)
  const counts = {};
  Object.values(vaultState.dailyLogs || {}).forEach((log) => {
    if (!Array.isArray(log?.symptoms)) return;
    log.symptoms.forEach((sym) => {
      if (VALID_SYMPTOMS.has(sym) || sym === 'sweet_cravings') {
        counts[sym] = (counts[sym] || 0) + 1;
      }
    });
  });

  const ranked = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  if (ranked.length === 0) {
    dom.insightsSymptomsList.innerHTML =
      '<p class="empty-hint">Log daily symptoms to see patterns here.</p>';
  } else {
    const topCount = ranked[0][1];
    const fragment = document.createDocumentFragment();

    ranked.forEach(([key, count]) => {
      const pct = Math.round((count / topCount) * 100);
      const row = document.createElement('div');
      row.className = 'symptom-bar-row';

      const meta = document.createElement('div');
      meta.className = 'symptom-bar-meta';

      const label = document.createElement('span');
      label.textContent = SYMPTOM_LABELS[key] || key;

      const val = document.createElement('span');
      val.className = 'tabular';
      val.textContent = `${count} ${count === 1 ? 'day' : 'days'}`;

      meta.append(label, val);

      const track = document.createElement('div');
      track.className = 'symptom-bar-track';

      const fill = document.createElement('div');
      fill.className = 'symptom-bar-fill';
      fill.style.width = `${pct}%`;

      track.appendChild(fill);
      row.append(meta, track);
      fragment.appendChild(row);
    });

    dom.insightsSymptomsList.replaceChildren(fragment);
  }

  // Cycle Rhythm Breakdown Segmented Bar
  renderCycleRhythm(forecast, periodStats);
}

function renderCycleRhythm(forecast, periodStats) {
  const total = Math.max(15, forecast.predictedCycleLength || 28);
  const menstrual = Math.min(total - 3, Math.max(1, periodStats.avgPeriodDays || 5));
  const luteal = Math.min(total - menstrual - 2, Math.max(1, forecast.lutealPhaseLength || 14));
  const ovulation = 1;
  const follicular = Math.max(1, total - menstrual - luteal - ovulation);

  dom.rhythmTotalDays.textContent = `${total}d cycle`;

  dom.rhythmSegMenstrual.style.flexGrow = String(menstrual);
  dom.rhythmSegFollicular.style.flexGrow = String(follicular);
  dom.rhythmSegOvulation.style.flexGrow = String(ovulation);
  dom.rhythmSegLuteal.style.flexGrow = String(luteal);

  dom.rhythmDaysMenstrual.textContent = `${menstrual}d`;
  dom.rhythmDaysFollicular.textContent = `${follicular}d`;
  dom.rhythmDaysOvulation.textContent = `${ovulation}d`;
  dom.rhythmDaysLuteal.textContent = `${luteal}d`;
}

/* ==========================================================================
   7. View D: Vault & Settings + Backups + Security
   ========================================================================== */
function syncPinLockVisibility() {
  const pinEnabled = isPinLockEnabled();
  if (dom.settingPinLock) {
    dom.settingPinLock.checked = pinEnabled;
  }
  dom.lockButtons.forEach((btn) => {
    btn.hidden = !pinEnabled;
  });
  if (dom.btnChangePin) {
    dom.btnChangePin.hidden = !pinEnabled;
  }
  if (dom.rowAutoLock) {
    dom.rowAutoLock.hidden = !pinEnabled;
  }
}

function renderSettingsView(vaultState) {
  const s = vaultState.settings || {};
  if (document.activeElement !== dom.settingName) {
    dom.settingName.value = s.userName || '';
  }
  dom.settingShowConception.checked = s.showConceptionChance !== false;
  syncPinLockVisibility();

  Object.keys(SETTING_LIMITS).forEach((key) => {
    const el = document.getElementById(`val-${key}`);
    if (el && s[key] !== undefined) {
      el.textContent = String(s[key]);
    }
  });
}

function triggerFileDownload(filename, content) {
  const blob = new Blob([content], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function initSettings() {
  const saveName = async () => {
    if (!isVaultUnlocked()) return;
    const nextName = dom.settingName.value.trim();
    await commitVaultState((draft) => {
      draft.settings.userName = nextName;
    });
    renderApp();
  };
  dom.settingName.addEventListener('change', saveName);

  dom.settingShowConception.addEventListener('change', async () => {
    if (!isVaultUnlocked()) return;
    const show = dom.settingShowConception.checked;
    await commitVaultState((draft) => {
      draft.settings.showConceptionChance = show;
    });
    renderApp();
  });

  document.querySelectorAll('.stepper').forEach((stepper) => {
    const key = stepper.dataset.setting;
    const limits = SETTING_LIMITS[key];
    if (!limits) return;

    stepper.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-delta]');
      if (!btn || !isVaultUnlocked()) return;
      const delta = Number(btn.dataset.delta);
      await commitVaultState((draft) => {
        const current = Number(draft.settings[key]) || limits.min;
        draft.settings[key] = Math.min(limits.max, Math.max(limits.min, current + delta));
      });
      renderApp();
      if (key === 'autoLockMinutes') resetInactivityTimer();
    });
  });

  dom.btnImportFlo.addEventListener('click', () => {
    dom.fileImportFlo.value = '';
    dom.fileImportFlo.click();
  });

  dom.fileImportFlo.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !isVaultUnlocked()) return;
    try {
      const jsonText = await file.text();
      const { vaultState, stats } = importFloData(jsonText, getVaultState());
      await commitVaultState(() => vaultState);
      renderApp();
      showToast(`Imported ${stats.importedCycles} cycles & ${stats.importedLogDays} log days`);
    } catch (err) {
      showToast(err.message || 'Flo import failed');
    }
  });

  dom.btnExportBackup.addEventListener('click', () => {
    openModal({
      title: 'Export Encrypted Backup',
      desc: `Choose a backup passphrase (min ${MIN_BACKUP_PASSPHRASE_LENGTH} characters). You will need this passphrase to restore the file.`,
      confirmLabel: 'Export',
      fields: [
        { id: 'modal-pass-1', type: 'password', placeholder: 'Backup passphrase' },
        { id: 'modal-pass-2', type: 'password', placeholder: 'Confirm passphrase' },
      ],
      onConfirm: async (values) => {
        const p1 = values['modal-pass-1'] || '';
        const p2 = values['modal-pass-2'] || '';
        if (p1.length < MIN_BACKUP_PASSPHRASE_LENGTH) {
          return `Passphrase must be at least ${MIN_BACKUP_PASSPHRASE_LENGTH} characters.`;
        }
        if (p1 !== p2) {
          return 'Passphrases do not match.';
        }
        const blobStr = await exportEncryptedBackup(p1);
        triggerFileDownload(`purin-backup-${getTodayIsoDate()}.enc.json`, blobStr);
        showToast('Encrypted backup downloaded');
        return null;
      },
    });
  });

  dom.btnImportBackup.addEventListener('click', () => {
    dom.fileImportBackup.value = '';
    dom.fileImportBackup.click();
  });

  dom.fileImportBackup.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file || !isVaultUnlocked()) return;
    const fileText = await file.text();
    openModal({
      title: 'Restore Encrypted Backup',
      desc: 'Enter the passphrase used when exporting this backup. This will replace your current vault data.',
      confirmLabel: 'Restore',
      fields: [
        { id: 'modal-restore-pass', type: 'password', placeholder: 'Backup passphrase' },
      ],
      onConfirm: async (values) => {
        const pass = values['modal-restore-pass'] || '';
        if (pass.length < MIN_BACKUP_PASSPHRASE_LENGTH) {
          return `Passphrase must be at least ${MIN_BACKUP_PASSPHRASE_LENGTH} characters.`;
        }
        try {
          await importEncryptedBackup(fileText, pass);
          renderApp();
          showToast('Encrypted backup restored');
          return null;
        } catch (err) {
          return err.message || 'Failed to decrypt backup.';
        }
      },
    });
  });

  dom.settingPinLock.addEventListener('change', () => {
    if (!isVaultUnlocked()) return;
    const wantsEnabled = dom.settingPinLock.checked;

    // Revert toggle visually until the modal confirmation completes
    dom.settingPinLock.checked = !wantsEnabled;

    if (wantsEnabled) {
      openModal({
        title: 'Enable 6-Digit PIN Lock',
        desc: 'Choose a 6-digit numeric PIN to lock Purin Cycle on this device.',
        confirmLabel: 'Enable PIN',
        fields: [
          { id: 'modal-enable-pin-1', type: 'password', inputMode: 'numeric', maxLength: 6, placeholder: 'New 6-digit PIN' },
          { id: 'modal-enable-pin-2', type: 'password', inputMode: 'numeric', maxLength: 6, placeholder: 'Confirm 6-digit PIN' },
        ],
        onConfirm: async (values) => {
          const pin = (values['modal-enable-pin-1'] || '').trim();
          const confirmPin = (values['modal-enable-pin-2'] || '').trim();
          if (!/^\d{6}$/.test(pin)) {
            return 'PIN must be exactly 6 numeric digits.';
          }
          if (pin !== confirmPin) {
            return 'PINs do not match.';
          }
          try {
            await enablePinLock(pin);
            renderApp();
            resetInactivityTimer();
            showToast('6-digit PIN lock enabled');
            return null;
          } catch (err) {
            return err.message || 'Could not enable PIN lock.';
          }
        },
      });
    } else {
      openModal({
        title: 'Turn Off PIN Lock',
        desc: 'Enter your current 6-digit PIN. Your data remains AES-256 encrypted locally on this device.',
        confirmLabel: 'Turn Off PIN',
        fields: [
          { id: 'modal-disable-pin', type: 'password', inputMode: 'numeric', maxLength: 6, placeholder: 'Current 6-digit PIN' },
        ],
        onConfirm: async (values) => {
          const curPin = (values['modal-disable-pin'] || '').trim();
          if (!/^\d{6}$/.test(curPin)) {
            return 'PIN must be exactly 6 numeric digits.';
          }
          try {
            await disablePinLock(curPin);
            clearTimeout(uiState.inactivityTimer);
            uiState.inactivityTimer = null;
            uiState.hiddenAt = null;
            renderApp();
            showToast('PIN lock turned off');
            return null;
          } catch (err) {
            return err.message || 'Incorrect PIN.';
          }
        },
      });
    }
  });

  dom.btnChangePin.addEventListener('click', () => {
    openModal({
      title: 'Change Vault PIN',
      desc: 'Enter your current 6-digit PIN and choose a new 6-digit PIN.',
      confirmLabel: 'Update PIN',
      fields: [
        { id: 'modal-cur-pin', type: 'password', inputMode: 'numeric', maxLength: 6, placeholder: 'Current 6-digit PIN' },
        { id: 'modal-new-pin', type: 'password', inputMode: 'numeric', maxLength: 6, placeholder: 'New 6-digit PIN' },
        { id: 'modal-new-pin-2', type: 'password', inputMode: 'numeric', maxLength: 6, placeholder: 'Confirm new PIN' },
      ],
      onConfirm: async (values) => {
        const cur = (values['modal-cur-pin'] || '').trim();
        const next = (values['modal-new-pin'] || '').trim();
        const next2 = (values['modal-new-pin-2'] || '').trim();
        if (!/^\d{6}$/.test(cur) || !/^\d{6}$/.test(next)) {
          return 'PINs must be exactly 6 numeric digits.';
        }
        if (next !== next2) {
          return 'New PINs do not match.';
        }
        try {
          await changeVaultPin(cur, next);
          showToast('Vault PIN updated');
          return null;
        } catch (err) {
          return err.message || 'Could not change PIN.';
        }
      },
    });
  });

  dom.btnPanicWipe.addEventListener('click', () => {
    openModal({
      title: 'Panic Wipe Vault?',
      desc: 'This permanently deletes your encrypted database from this device. Export a backup first if you want to keep your history.',
      confirmLabel: 'Continue',
      danger: true,
      fields: [],
      onConfirm: async () => {
        openModal({
          title: 'Confirm Permanent Deletion',
          desc: 'Type WIPE below to erase all local cycle data forever.',
          confirmLabel: 'Erase Forever',
          danger: true,
          fields: [
            { id: 'modal-wipe-word', type: 'text', placeholder: 'Type WIPE' },
          ],
          onConfirm: async (values) => {
            if ((values['modal-wipe-word'] || '').trim().toUpperCase() !== 'WIPE') {
              return 'Please type WIPE to confirm.';
            }
            await panicWipeVault();
            await createDeviceVault(createEmptyVaultState());
            uiState.vaultExists = true;
            uiState.onboardingStep = 'create';
            uiState.firstPinAttempt = '';
            uiState.stagedFloJson = null;
            uiState.hiddenAt = null;
            clearTimeout(uiState.inactivityTimer);
            uiState.inactivityTimer = null;
            dom.onboardingName.value = '';
            dom.onboardingFloStatus.hidden = true;
            closeLogDrawer(true);
            enterMainApp();
            showToast('Vault wiped');
            return null;
          },
        });
        return { keepOpen: true };
      },
    });
  });
}

/* ==========================================================================
   8. Reusable Modal Controller
   ========================================================================== */
function openModal({ title, desc, confirmLabel = 'Confirm', danger = false, fields = [], onConfirm }) {
  dom.modalTitle.textContent = title;
  dom.modalDesc.textContent = desc;
  dom.modalError.textContent = '';
  dom.btnModalConfirm.textContent = confirmLabel;
  dom.btnModalConfirm.classList.toggle('is-danger', danger);
  dom.btnModalConfirm.disabled = false;

  const fragment = document.createDocumentFragment();
  fields.forEach((f) => {
    const input = document.createElement('input');
    input.id = f.id;
    input.type = f.type || 'text';
    input.className = 'text-input';
    input.placeholder = f.placeholder || '';
    input.autocomplete = 'off';
    if (f.inputMode) input.inputMode = f.inputMode;
    if (f.maxLength) input.maxLength = f.maxLength;
    fragment.appendChild(input);
  });
  dom.modalFields.replaceChildren(fragment);

  uiState.modalConfirmHandler = onConfirm;
  dom.modalBackdrop.hidden = false;
  const firstInput = dom.modalFields.querySelector('input');
  if (firstInput) firstInput.focus();
}

function closeModal() {
  dom.modalBackdrop.hidden = true;
  dom.modalError.textContent = '';
  uiState.modalConfirmHandler = null;
}

function initModal() {
  dom.btnModalCancel.addEventListener('click', closeModal);
  dom.modalBackdrop.addEventListener('click', (e) => {
    if (e.target === dom.modalBackdrop) closeModal();
  });

  dom.modalFields.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !dom.btnModalConfirm.disabled) {
      e.preventDefault();
      dom.btnModalConfirm.click();
    }
  });

  dom.btnModalConfirm.addEventListener('click', async () => {
    if (!uiState.modalConfirmHandler) return;
    const values = {};
    dom.modalFields.querySelectorAll('input').forEach((input) => {
      values[input.id] = input.value;
    });

    dom.modalError.textContent = '';
    dom.btnModalConfirm.disabled = true;
    try {
      const result = await uiState.modalConfirmHandler(values);
      if (result && typeof result === 'object' && result.keepOpen) {
        return;
      }
      if (typeof result === 'string' && result.length > 0) {
        dom.modalError.textContent = result;
        dom.btnModalConfirm.disabled = false;
      } else {
        closeModal();
      }
    } catch (err) {
      dom.modalError.textContent = err.message || 'Operation failed.';
      dom.btnModalConfirm.disabled = false;
    }
  });
}

/* ==========================================================================
   9. Floating Cocoa Dock & Sliding Custard Pill Indicator
   ========================================================================== */
function updateDockIndicator(animate = true) {
  const activeTab = dom.dockPill.querySelector('.dock-tab--active');
  if (!activeTab || dom.appMain.hidden) return;

  if (!animate) {
    dom.dockIndicator.style.transition = 'none';
  }
  dom.dockIndicator.style.width = `${activeTab.offsetWidth}px`;
  dom.dockIndicator.style.transform = `translateX(${activeTab.offsetLeft}px)`;
  if (!animate) {
    void dom.dockIndicator.offsetWidth;
    dom.dockIndicator.style.transition = '';
  }
}

function switchTab(tabName) {
  uiState.activeTab = tabName;

  dom.dockTabs.forEach((tab) => {
    const isActive = tab.dataset.tab === tabName;
    tab.classList.toggle('dock-tab--active', isActive);
    tab.setAttribute('aria-selected', String(isActive));
  });

  dom.views.forEach((view) => {
    const isActive = view.dataset.view === tabName;
    view.hidden = !isActive;
    view.classList.toggle('app-view--active', isActive);
  });

  requestAnimationFrame(() => updateDockIndicator(true));

  if (tabName === 'calendar') {
    const today = getTodayIsoDate();
    uiState.calendarSelectedDate = today;
    requestAnimationFrame(() => {
      scrollCalendarToDate(today, 'smooth');
    });
  }
}

function initDock() {
  dom.dockTabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  window.addEventListener('resize', () => {
    if (!dom.appMain.hidden) {
      updateDockIndicator(false);
    }
  });
}

/* ==========================================================================
   10. Slide-Up Daily Log Drawer
   ========================================================================== */
function isLogEmpty(entry) {
  const hasFlow = entry.flow && entry.flow !== 'none';
  const hasSymptoms = Array.isArray(entry.symptoms) && entry.symptoms.length > 0;
  const hasMood = Boolean(entry.mood);
  const hasLh = Boolean(entry.lhTest);
  const hasMucus = Boolean(entry.cervicalMucus);
  const hasBbt = typeof entry.bbt === 'number' && !Number.isNaN(entry.bbt);
  const hasNote = Boolean(entry.note && entry.note.trim().length > 0);
  return !(hasFlow || hasSymptoms || hasMood || hasLh || hasMucus || hasBbt || hasNote);
}

const DRAWER_CAMEO_SPRITES = Object.freeze({
  eating: 'assets/icons/pompom/pompom_eating.png',
  sleeping: 'assets/icons/pompom/pompom_sleeping.png',
  love: 'assets/icons/pompom/pompom_love.png',
  waving: 'assets/icons/pompom/pompom_waving.png',
});

function getDrawerCycleSubtitle(isoDate, forecast) {
  if (!forecast || !forecast.hasData) {
    return 'Daily Check-in • Ready to Track';
  }

  if (isoDate === forecast.today && forecast.currentCycleDay) {
    const meta = PHASE_META[forecast.currentPhase || 'unknown'] || PHASE_META.unknown;
    return `Cycle Day ${forecast.currentCycleDay} • ${meta.label}`;
  }

  const calEntry = forecast.calendarMap?.[isoDate];
  const allCycles = [
    ...(Array.isArray(forecast.cycles) ? forecast.cycles : []),
    ...(Array.isArray(forecast.projectedCycles) ? forecast.projectedCycles : []),
  ].sort((a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0));

  let matchedCycle = null;
  for (let i = allCycles.length - 1; i >= 0; i--) {
    if (allCycles[i].startDate <= isoDate) {
      matchedCycle = allCycles[i];
      break;
    }
  }

  if (!matchedCycle) {
    return 'Daily Check-in • Past Entry';
  }

  const cycleDay = diffDays(matchedCycle.startDate, isoDate) + 1;
  let phaseLabel = 'Follicular Phase';

  if (calEntry?.isLoggedPeriod || calEntry?.isPredictedPeriod) {
    phaseLabel = 'Menstrual Phase';
  } else if (calEntry?.isConfirmedOvulation || calEntry?.isPredictedOvulation) {
    phaseLabel = 'Ovulation Phase';
  } else if (calEntry?.isFertileWindow) {
    phaseLabel = 'Fertile Window';
  } else {
    const cycleLen = forecast.predictedCycleLength || 28;
    const lutealLen = forecast.lutealPhaseLength || 14;
    const estOvulationDay = Math.max(1, cycleLen - lutealLen);
    if (cycleDay > cycleLen) {
      phaseLabel = 'Period Late';
    } else if (cycleDay > estOvulationDay) {
      phaseLabel = 'Luteal Phase';
    }
  }

  return `Cycle Day ${cycleDay} • ${phaseLabel}`;
}

function updateDrawerCameo(animate = true) {
  if (!dom.drawerPurinCameo) return;

  const selectedSymptoms = new Set(
    Array.from(dom.drawerSymptomsGroup.querySelectorAll('.chip-btn.is-selected')).map(
      (b) => b.dataset.symptom
    )
  );
  const selectedMoodBtn = dom.drawerMoodGroup.querySelector('.chip-btn.is-selected');
  const selectedMood = selectedMoodBtn ? selectedMoodBtn.dataset.mood : null;

  let nextSprite = DRAWER_CAMEO_SPRITES.waving;
  if (selectedSymptoms.has('sweet_cravings')) {
    nextSprite = DRAWER_CAMEO_SPRITES.eating;
  } else if (selectedSymptoms.has('fatigue') || selectedMood === 'low_energy') {
    nextSprite = DRAWER_CAMEO_SPRITES.sleeping;
  } else if (selectedMood === 'happy') {
    nextSprite = DRAWER_CAMEO_SPRITES.love;
  }

  const currentSrc = dom.drawerPurinCameo.getAttribute('src');
  const changed = currentSrc !== nextSprite;
  if (changed) {
    dom.drawerPurinCameo.setAttribute('src', nextSprite);
  }
  if (animate && changed && dom.drawerCameoFrame) {
    triggerJellyPop(dom.drawerCameoFrame);
  }
}

function populateDrawer(isoDate) {
  uiState.drawerDate = isoDate;
  dom.drawerDateTitle.textContent = formatLongDate(isoDate);
  if (dom.drawerCycleSubtitle) {
    dom.drawerCycleSubtitle.textContent = getDrawerCycleSubtitle(isoDate, uiState.latestForecast);
  }

  const vaultState = isVaultUnlocked() ? getVaultState() : null;
  const log = vaultState?.dailyLogs?.[isoDate] || {};

  // Flow
  const activeFlow = VALID_FLOWS.has(log.flow) ? log.flow : 'none';
  dom.drawerFlowGroup.querySelectorAll('.seg-btn').forEach((btn) => {
    const active = btn.dataset.flow === activeFlow;
    btn.classList.toggle('seg-btn--active', active);
    btn.setAttribute('aria-checked', String(active));
  });

  // Symptoms
  const symSet = new Set(Array.isArray(log.symptoms) ? log.symptoms : []);
  dom.drawerSymptomsGroup.querySelectorAll('.chip-btn').forEach((btn) => {
    const active = symSet.has(btn.dataset.symptom);
    btn.classList.toggle('is-selected', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  // Mood
  const activeMood = VALID_MOODS.has(log.mood) ? log.mood : null;
  dom.drawerMoodGroup.querySelectorAll('.chip-btn').forEach((btn) => {
    const active = btn.dataset.mood === activeMood;
    btn.classList.toggle('is-selected', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  // Note
  dom.drawerNote.value = typeof log.note === 'string' ? log.note : '';

  // Sync live Pompompurin reaction cameo
  updateDrawerCameo(false);
}

function collectDrawerEntry() {
  const flowBtn = dom.drawerFlowGroup.querySelector('.seg-btn--active');
  const flow = flowBtn ? flowBtn.dataset.flow : 'none';

  const symptoms = Array.from(
    dom.drawerSymptomsGroup.querySelectorAll('.chip-btn.is-selected')
  ).map((b) => b.dataset.symptom);

  const moodBtn = dom.drawerMoodGroup.querySelector('.chip-btn.is-selected');
  const note = dom.drawerNote.value.trim();

  const entry = { flow };
  if (symptoms.length > 0) entry.symptoms = symptoms;
  if (moodBtn) entry.mood = moodBtn.dataset.mood;
  if (note.length > 0) entry.note = note;

  return entry;
}

function openLogDrawer(isoDate = uiState.selectedDate) {
  if (!isVaultUnlocked()) return;
  populateDrawer(isoDate);

  if (uiState.drawerOpen) return;
  uiState.drawerOpen = true;
  dom.btnQuickLog.classList.add('is-open');
  dom.drawerBackdrop.hidden = false;
  dom.logDrawer.inert = false;
  dom.logDrawer.setAttribute('aria-hidden', 'false');

  requestAnimationFrame(() => {
    dom.drawerBackdrop.classList.add('is-open');
    dom.logDrawer.classList.add('is-open');
  });
}

function closeLogDrawer(immediate = false) {
  if (!uiState.drawerOpen) return;
  uiState.drawerOpen = false;
  dom.btnQuickLog.classList.remove('is-open');
  dom.drawerBackdrop.classList.remove('is-open');
  dom.logDrawer.classList.remove('is-open');
  dom.logDrawer.setAttribute('aria-hidden', 'true');
  dom.logDrawer.inert = true;

  if (immediate) {
    dom.drawerBackdrop.hidden = true;
    return;
  }

  setTimeout(() => {
    if (!uiState.drawerOpen) {
      dom.drawerBackdrop.hidden = true;
    }
  }, 340);
}

function initDrawer() {
  dom.logDrawer.inert = true;

  dom.btnQuickLog.addEventListener('click', () => {
    if (uiState.drawerOpen) {
      closeLogDrawer(false);
    } else {
      const targetDate = uiState.activeTab === 'calendar'
        ? uiState.calendarSelectedDate
        : uiState.selectedDate;
      openLogDrawer(targetDate || getTodayIsoDate());
    }
  });
  dom.btnCloseDrawer.addEventListener('click', () => closeLogDrawer(false));
  dom.drawerBackdrop.addEventListener('click', () => closeLogDrawer(false));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!dom.modalBackdrop.hidden) {
        closeModal();
      } else if (uiState.drawerOpen) {
        closeLogDrawer(false);
      }
    }
  });

  // Segmented flow selector with jellyPop
  dom.drawerFlowGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-flow]');
    if (!btn) return;
    dom.drawerFlowGroup.querySelectorAll('.seg-btn').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('seg-btn--active', active);
      b.setAttribute('aria-checked', String(active));
    });
    triggerJellyPop(btn);
  });

  // Multi-select symptoms with jellyPop + live Purin reaction cameo
  dom.drawerSymptomsGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-symptom]');
    if (!btn) return;
    const selected = btn.classList.toggle('is-selected');
    btn.setAttribute('aria-pressed', String(selected));
    triggerJellyPop(btn);
    updateDrawerCameo(true);
  });

  // Single-select mood group with jellyPop + live Purin reaction cameo
  dom.drawerMoodGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('.chip-btn');
    if (!btn) return;
    const wasSelected = btn.classList.contains('is-selected');
    dom.drawerMoodGroup.querySelectorAll('.chip-btn').forEach((b) => {
      b.classList.remove('is-selected');
      b.setAttribute('aria-pressed', 'false');
    });
    if (!wasSelected) {
      btn.classList.add('is-selected');
      btn.setAttribute('aria-pressed', 'true');
    }
    triggerJellyPop(btn);
    updateDrawerCameo(true);
  });

  dom.btnSaveLog.addEventListener('click', async () => {
    if (!isVaultUnlocked() || dom.btnSaveLog.disabled) return;

    const dateKey = uiState.drawerDate;
    const entry = collectDrawerEntry();
    const isNowBleeding = BLEEDING_FLOWS.has(entry.flow);

    triggerJellyPop(dom.btnSaveLog);
    dom.btnSaveLog.disabled = true;
    try {
      await commitVaultState((draft) => {
        const prevEntry = draft.dailyLogs[dateKey];
        const wasBleeding =
          BLEEDING_FLOWS.has(prevEntry?.flow) ||
          Boolean(uiState.latestForecast?.calendarMap?.[dateKey]?.isLoggedPeriod);
        const removedFlowDates = wasBleeding && !isNowBleeding ? [dateKey] : [];

        // Preserve any existing imported biomarker fields if present
        if (prevEntry?.lhTest) entry.lhTest = prevEntry.lhTest;
        if (prevEntry?.cervicalMucus) entry.cervicalMucus = prevEntry.cervicalMucus;
        if (typeof prevEntry?.bbt === 'number') entry.bbt = prevEntry.bbt;

        if (isLogEmpty(entry)) {
          delete draft.dailyLogs[dateKey];
        } else {
          draft.dailyLogs[dateKey] = entry;
        }

        draft.cycles = rebuildCyclesFromLogs(draft.dailyLogs, draft.cycles, {
          removedFlowDates,
        });
      });
      uiState.speechOverrideKey = null;
      closeLogDrawer(false);
      renderApp();
      showToast('Entry saved');
    } catch (err) {
      showToast(err.message || 'Could not save entry');
    } finally {
      dom.btnSaveLog.disabled = false;
    }
  });
}

/* ==========================================================================
   11. Offline Service Worker Registration (Phase 4 PWA)
   ========================================================================== */
function setOfflineBadge(label, isReady = false) {
  if (!dom.pwaOfflineBadge) return;
  dom.pwaOfflineBadge.textContent = label;
  dom.pwaOfflineBadge.classList.toggle('is-ready', isReady);
}

function initServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setOfflineBadge('Offline Unsupported', false);
    return;
  }

  const markReady = () => setOfflineBadge('Offline Ready ✓', true);

  if (navigator.serviceWorker.controller) {
    markReady();
  }

  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((registration) => {
      if (registration.active) {
        markReady();
        return;
      }
      const worker = registration.installing || registration.waiting;
      if (worker) {
        worker.addEventListener('statechange', () => {
          if (worker.state === 'activated') {
            markReady();
          }
        });
      }
      return navigator.serviceWorker.ready.then(markReady);
    })
    .catch((err) => {
      console.error('[Purin Cycle] Service Worker registration failed:', err);
      setOfflineBadge('Offline Unavailable', false);
    });
}

/* ==========================================================================
   12. Boot
   ========================================================================== */
async function boot() {
  initServiceWorker();
  initSplash();
  initPinGate();
  initAutoLock();
  initTodayActions();
  initCalendar();
  initSettings();
  initModal();
  initDock();
  initDrawer();

  try {
    uiState.vaultExists = await hasExistingVault();
  } catch {
    uiState.vaultExists = false;
  }

  if (!uiState.vaultExists) {
    try {
      await createDeviceVault(createEmptyVaultState());
      uiState.vaultExists = true;
      enterMainApp();
      return;
    } catch (err) {
      dom.pinGate.hidden = false;
      configurePinGateUI();
      triggerPinError(err.message || 'Could not initialize local vault.');
      return;
    }
  }

  if (!isPinLockEnabled()) {
    try {
      await unlockDeviceVault();
      enterMainApp();
      return;
    } catch (err) {
      dom.pinGate.hidden = false;
      configurePinGateUI();
      triggerPinError(err.message || 'Could not unlock local vault.');
      return;
    }
  }

  dom.pinGate.hidden = false;
  configurePinGateUI();
}

boot();
