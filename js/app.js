/**
 * Purin Cycle — Phase 3 Production UI & Integration Controller
 * Connects Phase 1 (predictionEngine.js, floImporter.js) and Phase 2 (vaultCrypto.js)
 * to the mobile-first native app shell.
 */

import {
  hasExistingVault,
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
   Constants & Phase Presentation Map
   ========================================================================== */
const SPLASH_FADE_MS = 1200;
const RING_RADIUS = 106;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const PHASE_META = Object.freeze({
  menstrual: {
    label: 'Menstrual Phase',
    sprite: 'assets/icons/pompom/pompom_sleeping.png',
    spriteClass: 'mascot-menstrual',
  },
  follicular: {
    label: 'Follicular Phase',
    sprite: 'assets/icons/pompom/pompom_energetic.png',
    spriteClass: 'mascot-follicular',
  },
  fertile: {
    label: 'Fertile Window',
    sprite: 'assets/icons/pompom/pompom_love.png',
    spriteClass: 'mascot-fertile',
  },
  ovulation: {
    label: 'Ovulation Phase',
    sprite: 'assets/icons/pompom/pompom_love.png',
    spriteClass: 'mascot-ovulation',
  },
  luteal: {
    label: 'Luteal Phase',
    sprite: 'assets/icons/pompom/pompom_eating.png',
    spriteClass: 'mascot-luteal',
  },
  late: {
    label: 'Period Late',
    sprite: 'assets/icons/pompom/pompom_eating.png',
    spriteClass: 'mascot-luteal',
  },
  unknown: {
    label: 'Ready to Track',
    sprite: 'assets/icons/pompom/pompom_energetic.png',
    spriteClass: 'mascot-follicular',
  },
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
  fatigue: 'Fatigue',
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
  dockTabs: Array.from(document.querySelectorAll('.dock-tab')),
  views: Array.from(document.querySelectorAll('.app-view')),
  btnQuickLog: document.getElementById('btn-quick-log'),

  // Today Dashboard
  greetingTitle: document.getElementById('greeting-title'),
  greetingDate: document.getElementById('greeting-date'),
  weekStrip: document.getElementById('week-strip'),
  ringArcPeriodExpected: document.getElementById('ring-arc-period-expected'),
  ringArcPeriod: document.getElementById('ring-arc-period'),
  ringArcFertile: document.getElementById('ring-arc-fertile'),
  ringOvulationDot: document.getElementById('ring-ovulation-dot'),
  ringMarker: document.getElementById('ring-marker'),
  cycleDayLabel: document.getElementById('cycle-day-label'),
  cyclePhaseLabel: document.getElementById('cycle-phase-label'),
  cycleMascotImg: document.getElementById('cycle-mascot-img'),
  btnLogPeriod: document.getElementById('btn-log-period'),
  btnLogPeriodLabel: document.getElementById('btn-log-period-label'),
  cardConception: document.getElementById('card-conception'),
  conceptionPill: document.getElementById('conception-pill'),
  conceptionLabel: document.getElementById('conception-label'),
  forecastEyebrow: document.getElementById('forecast-eyebrow'),
  forecastDate: document.getElementById('forecast-date'),
  forecastWindow: document.getElementById('forecast-window'),

  // Calendar
  calMonthLabel: document.getElementById('cal-month-label'),
  calendarGrid: document.getElementById('calendar-grid'),
  btnCalPrev: document.getElementById('btn-cal-prev'),
  btnCalNext: document.getElementById('btn-cal-next'),
  btnCalToday: document.getElementById('btn-cal-today'),
  calSummaryDate: document.getElementById('cal-summary-date'),
  calSummaryPhase: document.getElementById('cal-summary-phase'),
  calSummaryDetails: document.getElementById('cal-summary-details'),
  btnCalEditLog: document.getElementById('btn-cal-edit-log'),

  // Insights
  metricAvgCycle: document.getElementById('metric-avg-cycle'),
  metricAvgPeriod: document.getElementById('metric-avg-period'),
  metricAvgPeriodSub: document.getElementById('metric-avg-period-sub'),
  metricRegularity: document.getElementById('metric-regularity'),
  metricRegularitySub: document.getElementById('metric-regularity-sub'),
  metricLuteal: document.getElementById('metric-luteal'),
  insightsCyclesList: document.getElementById('insights-cycles-list'),
  insightsSymptomsList: document.getElementById('insights-symptoms-list'),

  // Settings
  settingName: document.getElementById('setting-name'),
  settingShowConception: document.getElementById('setting-show-conception'),
  btnImportFlo: document.getElementById('btn-import-flo'),
  fileImportFlo: document.getElementById('file-import-flo'),
  btnExportBackup: document.getElementById('btn-export-backup'),
  btnImportBackup: document.getElementById('btn-import-backup'),
  fileImportBackup: document.getElementById('file-import-backup'),
  btnChangePin: document.getElementById('btn-change-pin'),
  btnPanicWipe: document.getElementById('btn-panic-wipe'),

  // Drawer
  drawerBackdrop: document.getElementById('log-drawer-backdrop'),
  logDrawer: document.getElementById('log-drawer'),
  drawerDateTitle: document.getElementById('drawer-date-title'),
  btnCloseDrawer: document.getElementById('btn-close-drawer'),
  btnSaveLog: document.getElementById('btn-save-log'),
  drawerFlowGroup: document.getElementById('drawer-flow-group'),
  drawerSymptomsGroup: document.getElementById('drawer-symptoms-group'),
  drawerMoodGroup: document.getElementById('drawer-mood-group'),
  drawerLhGroup: document.getElementById('drawer-lh-group'),
  drawerMucusGroup: document.getElementById('drawer-mucus-group'),
  drawerBbt: document.getElementById('drawer-bbt'),
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
const todayInitial = parseIsoDate(getTodayIsoDate());

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
  calendarYear: todayInitial.getFullYear(),
  calendarMonth: todayInitial.getMonth(), // 0-indexed
  latestForecast: null,

  // Drawer & modal state
  drawerOpen: false,
  drawerDate: getTodayIsoDate(),
  modalConfirmHandler: null,

  // Timers
  toastTimer: null,
  inactivityTimer: null,
};

/* ==========================================================================
   Date Formatting Helpers
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
  }, 300);
  uiState.splashTimers.push(removeTimer);
}

function initSplash() {
  const fadeTimer = setTimeout(() => dismissSplash(false), SPLASH_FADE_MS);
  uiState.splashTimers.push(fadeTimer);

  dom.splash.addEventListener('click', () => dismissSplash(true));
  dom.splash.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      dismissSplash(true);
    }
  });
}

/* ==========================================================================
   2. Vault Gate, First-Time Onboarding & Auto-Lock
   ========================================================================== */
function configurePinGateUI() {
  uiState.pinBuffer = '';
  renderPinDots();
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

function renderPinDots() {
  const dots = dom.pinDots.querySelectorAll('.pin-dot');
  dots.forEach((dot, idx) => {
    dot.classList.toggle('is-filled', idx < uiState.pinBuffer.length);
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
  renderPinDots();
}

function handlePinKey(key) {
  if (dom.pinGate.hidden || uiState.pinBusy) return;
  dom.pinError.textContent = '';

  if (key === 'clear') {
    uiState.pinBuffer = '';
    renderPinDots();
    return;
  }

  if (key === 'backspace') {
    uiState.pinBuffer = uiState.pinBuffer.slice(0, -1);
    renderPinDots();
    return;
  }

  if (/^\d$/.test(key) && uiState.pinBuffer.length < PIN_LENGTH) {
    uiState.pinBuffer += key;
    renderPinDots();

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
      renderPinDots();
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
    renderPinDots();
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
  const parsed = parseIsoDate(today);
  uiState.calendarYear = parsed.getFullYear();
  uiState.calendarMonth = parsed.getMonth();

  dom.pinGate.hidden = true;
  dom.appMain.hidden = false;
  switchTab('today');
  renderApp();
  resetInactivityTimer();
}

function lockToPinGate(showLockedToast = false) {
  clearTimeout(uiState.inactivityTimer);
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

function resetInactivityTimer() {
  clearTimeout(uiState.inactivityTimer);
  if (!isVaultUnlocked()) return;

  let minutes = 5;
  try {
    const state = getVaultState();
    minutes = Math.max(1, Number(state.settings?.autoLockMinutes) || 5);
  } catch {
    return;
  }

  uiState.inactivityTimer = setTimeout(() => {
    if (isVaultUnlocked()) {
      lockToPinGate(true);
    }
  }, minutes * 60_000);
}

function initAutoLock() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && isVaultUnlocked()) {
      lockToPinGate(false);
    }
  });

  ['pointerdown', 'keydown', 'touchstart'].forEach((evt) => {
    document.addEventListener(evt, () => {
      if (isVaultUnlocked()) resetInactivityTimer();
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
  const completedCycles = (forecast.cycles || []).filter((c) => c.cycleLength != null);

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
   4. View A: Today Dashboard
   ========================================================================== */
function renderTodayView(vaultState, forecast, todayStr) {
  const userName = (vaultState.settings?.userName || '').trim();
  dom.greetingTitle.textContent = `Hello, ${userName || 'Friend'}`;
  dom.greetingDate.textContent = formatLongDate(uiState.selectedDate);

  renderWeekStrip(forecast, todayStr);
  renderCycleRing(vaultState, forecast);

  // Primary Action CTA ("Log Period +") reflects today's logged/imported period status
  const isPeriodToday = Boolean(forecast.calendarMap?.[todayStr]?.isLoggedPeriod);
  dom.btnLogPeriod.classList.toggle('is-active', isPeriodToday);
  dom.btnLogPeriodLabel.textContent = isPeriodToday ? 'Period Logged ✓' : 'Log Period +';

  // Card 1: Conception Chance
  const showConception = vaultState.settings?.showConceptionChance !== false;
  dom.cardConception.hidden = !showConception;
  const isHighConception =
    forecast.currentPhase === 'fertile' || forecast.currentPhase === 'ovulation';
  dom.conceptionPill.classList.toggle('status-pill--high', isHighConception);
  dom.conceptionPill.classList.toggle('status-pill--low', !isHighConception);
  dom.conceptionLabel.textContent = isHighConception ? 'High' : 'Low';

  // Card 2: Next Period Forecast
  if (!forecast.hasData) {
    dom.forecastEyebrow.textContent = 'Next expected period';
    dom.forecastDate.textContent = 'No history yet';
    dom.forecastWindow.textContent = 'Tap "Log Period +" or import Flo data to begin';
  } else if (forecast.isLate) {
    dom.forecastEyebrow.textContent = 'Cycle Status';
    dom.forecastDate.textContent = `Period is ${forecast.daysLate} ${forecast.daysLate === 1 ? 'day' : 'days'} late`;
    dom.forecastWindow.textContent = `Originally expected ${formatShortDate(forecast.expectedNextPeriodStart)}`;
  } else {
    dom.forecastEyebrow.textContent = 'Next expected period';
    dom.forecastDate.textContent = formatShortDateWithYear(forecast.predictedNextPeriodStart);
    if (forecast.periodArrivalWindow) {
      dom.forecastWindow.textContent =
        `Window: ${formatShortDate(forecast.periodArrivalWindow.earliest)} – ${formatShortDate(forecast.periodArrivalWindow.latest)}`;
    } else {
      dom.forecastWindow.textContent = '';
    }
  }
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

  // Update mascot sprite & phase-specific framing class
  dom.cycleMascotImg.src = meta.sprite;
  dom.cycleMascotImg.className = `cycle-mascot-img ${meta.spriteClass}`;
  dom.cyclePhaseLabel.textContent = meta.label;

  if (!forecast.hasData || !forecast.currentCycleDay) {
    dom.cycleDayLabel.textContent = 'Day —';
    dom.ringArcPeriodExpected.style.strokeDasharray = `0 ${RING_CIRCUMFERENCE}`;
    dom.ringArcPeriod.style.strokeDasharray = `0 ${RING_CIRCUMFERENCE}`;
    dom.ringArcFertile.style.strokeDasharray = `0 ${RING_CIRCUMFERENCE}`;
    dom.ringOvulationDot.style.opacity = '0';
    dom.ringMarker.style.opacity = '0';
    return;
  }

  dom.cycleDayLabel.textContent = `Day ${forecast.currentCycleDay}`;
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
    dom.ringArcFertile.style.strokeDasharray = `0 ${RING_CIRCUMFERENCE}`;
  }

  // Distinct dark-matcha ovulation marker dot (#3F7A52) on exact predictedOvulationDate
  if (forecast.activeCycle && forecast.predictedOvulationDate) {
    const ovOffsetDays = diffDays(forecast.activeCycle.startDate, forecast.predictedOvulationDate);
    if (ovOffsetDays >= 0 && ovOffsetDays < cycleLen) {
      const ovAngle = (ovOffsetDays / cycleLen) * 2 * Math.PI;
      const ovCx = 120 + RING_RADIUS * Math.cos(ovAngle);
      const ovCy = 120 + RING_RADIUS * Math.sin(ovAngle);
      dom.ringOvulationDot.setAttribute('cx', ovCx.toFixed(2));
      dom.ringOvulationDot.setAttribute('cy', ovCy.toFixed(2));
      dom.ringOvulationDot.style.opacity = '1';
    } else {
      dom.ringOvulationDot.style.opacity = '0';
    }
  } else {
    dom.ringOvulationDot.style.opacity = '0';
  }

  // Current cycle day marker dot (SVG is rotated -90deg so angle 0 = 12 o'clock)
  const progress = Math.min(1, Math.max(0, (forecast.currentCycleDay - 1) / cycleLen));
  const angle = progress * 2 * Math.PI;
  const cx = 120 + RING_RADIUS * Math.cos(angle);
  const cy = 120 + RING_RADIUS * Math.sin(angle);
  dom.ringMarker.setAttribute('cx', cx.toFixed(2));
  dom.ringMarker.setAttribute('cy', cy.toFixed(2));
}

function initTodayActions() {
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
      renderApp();
      showToast(nowLogged ? 'Period logged for today' : 'Period removed for today');
    } catch (err) {
      showToast(err.message || 'Could not update period');
    } finally {
      dom.btnLogPeriod.disabled = false;
    }
  });
}

/* ==========================================================================
   5. View B: Monthly Calendar
   ========================================================================== */
function renderCalendarView(vaultState, forecast, todayStr) {
  const year = uiState.calendarYear;
  const month = uiState.calendarMonth;
  dom.calMonthLabel.textContent = `${MONTH_NAMES[month]} ${year}`;

  const firstOfMonth = new Date(year, month, 1, 12, 0, 0, 0);
  const firstWeekday = firstOfMonth.getDay(); // 0 = Sun
  const daysInMonth = new Date(year, month + 1, 0, 12, 0, 0, 0).getDate();
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  const firstIso = formatIsoDate(firstOfMonth);
  const gridStartIso = addDays(firstIso, -firstWeekday);
  const fragment = document.createDocumentFragment();

  for (let i = 0; i < totalCells; i++) {
    const iso = addDays(gridStartIso, i);
    const d = parseIsoDate(iso);
    const inCurrentMonth = d.getMonth() === month;
    const entry = forecast.calendarMap[iso];

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cal-cell';
    btn.dataset.date = iso;
    btn.setAttribute('aria-label', formatLongDate(iso));
    btn.setAttribute('aria-pressed', String(iso === uiState.calendarSelectedDate));

    if (!inCurrentMonth) btn.classList.add('cal-cell--other-month');
    if (iso === todayStr) btn.classList.add('cal-cell--today');
    if (iso === uiState.calendarSelectedDate) btn.classList.add('cal-cell--selected');

    const isOvulation = Boolean(entry && (entry.isConfirmedOvulation || entry.isPredictedOvulation));
    if (entry?.isLoggedPeriod) {
      btn.classList.add('cal-cell--logged_period');
    } else if (isOvulation) {
      btn.classList.add('cal-cell--ovulation');
    } else if (entry?.isPredictedPeriod) {
      btn.classList.add('cal-cell--predicted_period');
    } else if (entry?.isFertileWindow) {
      btn.classList.add('cal-cell--fertile');
    }

    const num = document.createElement('span');
    num.textContent = String(d.getDate());
    btn.appendChild(num);

    if (isOvulation) {
      const star = document.createElement('span');
      star.className = 'cal-cell-star';
      star.textContent = '★';
      star.setAttribute('aria-hidden', 'true');
      btn.appendChild(star);
    }

    if (entry?.hasLog) {
      const dot = document.createElement('span');
      dot.className = 'cal-cell-dot';
      dot.setAttribute('aria-hidden', 'true');
      btn.appendChild(dot);
    }

    fragment.appendChild(btn);
  }

  dom.calendarGrid.replaceChildren(fragment);
  renderCalendarDaySummary(vaultState, forecast);
}

function getDatePhaseAndCycleDay(isoDate, forecast) {
  const entry = forecast.calendarMap?.[isoDate];
  let cycleDay = entry?.cycleDay || null;

  if (!cycleDay && Array.isArray(forecast.cycles) && forecast.cycles.length > 0) {
    // Find latest cycle starting on or before isoDate
    for (let i = forecast.cycles.length - 1; i >= 0; i--) {
      const c = forecast.cycles[i];
      if (isoDate >= c.startDate) {
        const diff = diffDays(c.startDate, isoDate) + 1;
        if (c.cycleLength == null || diff <= c.cycleLength) {
          cycleDay = diff;
        }
        break;
      }
    }
  }

  let phaseLabel = 'No phase data';
  if (entry?.isLoggedPeriod) {
    phaseLabel = 'Logged Period';
  } else if (entry?.isConfirmedOvulation) {
    phaseLabel = 'Confirmed Ovulation';
  } else if (entry?.isPredictedOvulation) {
    phaseLabel = 'Predicted Ovulation';
  } else if (entry?.isPredictedPeriod) {
    phaseLabel = 'Predicted Period';
  } else if (entry?.isFertileWindow) {
    phaseLabel = 'Fertile Window';
  } else if (cycleDay) {
    phaseLabel = forecast.predictedOvulationDate && isoDate > forecast.predictedOvulationDate
      ? 'Luteal Phase'
      : 'Follicular Phase';
  }

  return { cycleDay, phaseLabel };
}

function renderCalendarDaySummary(vaultState, forecast) {
  const iso = uiState.calendarSelectedDate || getTodayIsoDate();
  dom.calSummaryDate.textContent = formatLongDate(iso);

  const { cycleDay, phaseLabel } = getDatePhaseAndCycleDay(iso, forecast);
  dom.calSummaryPhase.textContent = cycleDay
    ? `Cycle Day ${cycleDay} · ${phaseLabel}`
    : phaseLabel;

  const log = vaultState?.dailyLogs?.[iso];
  const tags = [];
  if (log?.flow && log.flow !== 'none') {
    tags.push(FLOW_LABELS[log.flow] || log.flow);
  }
  if (log?.mood && MOOD_LABELS[log.mood]) {
    tags.push(`Mood: ${MOOD_LABELS[log.mood]}`);
  }
  if (Array.isArray(log?.symptoms)) {
    log.symptoms.forEach((s) => tags.push(SYMPTOM_LABELS[s] || s));
  }
  if (log?.lhTest) {
    tags.push(`LH: ${log.lhTest === 'positive' ? 'Positive' : 'Negative'}`);
  }
  if (typeof log?.bbt === 'number') {
    tags.push(`BBT: ${log.bbt.toFixed(2)}°C`);
  }

  const fragment = document.createDocumentFragment();
  if (tags.length === 0 && !log?.note) {
    const empty = document.createElement('p');
    empty.className = 'empty-hint';
    empty.textContent = 'No logs recorded';
    fragment.appendChild(empty);
  } else {
    if (tags.length > 0) {
      const tagWrap = document.createElement('div');
      tagWrap.className = 'day-summary-tags';
      tags.forEach((text) => {
        const pill = document.createElement('span');
        pill.className = 'day-summary-tag';
        pill.textContent = text;
        tagWrap.appendChild(pill);
      });
      fragment.appendChild(tagWrap);
    }
    if (log?.note) {
      const noteEl = document.createElement('p');
      noteEl.className = 'day-summary-note';
      noteEl.textContent = `"${log.note}"`;
      fragment.appendChild(noteEl);
    }
  }

  dom.calSummaryDetails.replaceChildren(fragment);
}

function initCalendar() {
  dom.btnCalPrev.addEventListener('click', () => {
    uiState.calendarMonth -= 1;
    if (uiState.calendarMonth < 0) {
      uiState.calendarMonth = 11;
      uiState.calendarYear -= 1;
    }
    if (uiState.latestForecast && isVaultUnlocked()) {
      renderCalendarView(getVaultState(), uiState.latestForecast, getTodayIsoDate());
    }
  });

  dom.btnCalNext.addEventListener('click', () => {
    uiState.calendarMonth += 1;
    if (uiState.calendarMonth > 11) {
      uiState.calendarMonth = 0;
      uiState.calendarYear += 1;
    }
    if (uiState.latestForecast && isVaultUnlocked()) {
      renderCalendarView(getVaultState(), uiState.latestForecast, getTodayIsoDate());
    }
  });

  dom.btnCalToday.addEventListener('click', () => {
    const today = getTodayIsoDate();
    const now = parseIsoDate(today);
    uiState.calendarYear = now.getFullYear();
    uiState.calendarMonth = now.getMonth();
    uiState.calendarSelectedDate = today;
    if (uiState.latestForecast && isVaultUnlocked()) {
      renderCalendarView(getVaultState(), uiState.latestForecast, today);
    }
  });

  dom.calendarGrid.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-date]');
    if (!cell || !uiState.latestForecast || !isVaultUnlocked()) return;
    uiState.calendarSelectedDate = cell.dataset.date;
    renderCalendarView(getVaultState(), uiState.latestForecast, getTodayIsoDate());
  });

  dom.btnCalEditLog.addEventListener('click', () => {
    openLogDrawer(uiState.calendarSelectedDate || getTodayIsoDate());
  });
}

/* ==========================================================================
   6. View C: Cycle Insights
   ========================================================================== */
function renderInsightsView(vaultState, forecast) {
  const periodStats = getInsightsPeriodStats(vaultState, forecast);

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
  const recentCycles = [...(forecast.cycles || [])].slice(-6).reverse();
  if (recentCycles.length === 0) {
    dom.insightsCyclesList.innerHTML =
      '<p class="empty-hint">No completed cycles recorded yet.</p>';
  } else {
    const maxLen = Math.max(
      35,
      ...recentCycles.map((c) => c.cycleLength || forecast.currentCycleDay || 28)
    );
    const fragment = document.createDocumentFragment();

    recentCycles.forEach((cycle) => {
      const isOngoing = cycle.cycleLength == null;
      const len = isOngoing
        ? Math.max(1, diffDays(cycle.startDate, forecast.today) + 1)
        : cycle.cycleLength;
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

  // Top Symptoms Summary
  const counts = {};
  Object.values(vaultState.dailyLogs || {}).forEach((log) => {
    if (!Array.isArray(log?.symptoms)) return;
    log.symptoms.forEach((sym) => {
      if (VALID_SYMPTOMS.has(sym)) {
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
}

/* ==========================================================================
   7. View D: Vault & Settings + Backups + Security
   ========================================================================== */
function renderSettingsView(vaultState) {
  const s = vaultState.settings || {};
  if (document.activeElement !== dom.settingName) {
    dom.settingName.value = s.userName || '';
  }
  dom.settingShowConception.checked = s.showConceptionChance !== false;

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
  // Display name
  const saveName = async () => {
    if (!isVaultUnlocked()) return;
    const nextName = dom.settingName.value.trim();
    await commitVaultState((draft) => {
      draft.settings.userName = nextName;
    });
    renderApp();
  };
  dom.settingName.addEventListener('change', saveName);

  // Conception chance toggle
  dom.settingShowConception.addEventListener('change', async () => {
    if (!isVaultUnlocked()) return;
    const show = dom.settingShowConception.checked;
    await commitVaultState((draft) => {
      draft.settings.showConceptionChance = show;
    });
    renderApp();
  });

  // Numeric steppers
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

  // Import Flo History (.json)
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

  // Export Encrypted Backup (.enc.json)
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

  // Import Encrypted Backup (.enc.json)
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

  // Change Vault PIN
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

  // Panic Wipe (2-Step Confirmation)
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
            uiState.vaultExists = false;
            uiState.onboardingStep = 'create';
            uiState.firstPinAttempt = '';
            uiState.stagedFloJson = null;
            dom.onboardingName.value = '';
            dom.onboardingFloStatus.hidden = true;
            lockToPinGate(false);
            showToast('Vault permanently wiped');
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
   9. Floating Cocoa Dock Tab Switching
   ========================================================================== */
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
}

function initDock() {
  dom.dockTabs.forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
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

function populateDrawer(isoDate) {
  uiState.drawerDate = isoDate;
  dom.drawerDateTitle.textContent = formatLongDate(isoDate);

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

  // LH Test
  const activeLh = VALID_LH_TESTS.has(log.lhTest) ? log.lhTest : null;
  dom.drawerLhGroup.querySelectorAll('.chip-btn').forEach((btn) => {
    const active = btn.dataset.lh === activeLh;
    btn.classList.toggle('is-selected', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  // Cervical Mucus
  const activeMucus = VALID_CERVICAL_MUCUS.has(log.cervicalMucus) ? log.cervicalMucus : null;
  dom.drawerMucusGroup.querySelectorAll('.chip-btn').forEach((btn) => {
    const active = btn.dataset.mucus === activeMucus;
    btn.classList.toggle('is-selected', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  // BBT & Note
  dom.drawerBbt.value = typeof log.bbt === 'number' ? String(log.bbt) : '';
  dom.drawerNote.value = typeof log.note === 'string' ? log.note : '';
}

function collectDrawerEntry() {
  const flowBtn = dom.drawerFlowGroup.querySelector('.seg-btn--active');
  const flow = flowBtn ? flowBtn.dataset.flow : 'none';

  const symptoms = Array.from(
    dom.drawerSymptomsGroup.querySelectorAll('.chip-btn.is-selected')
  ).map((b) => b.dataset.symptom);

  const moodBtn = dom.drawerMoodGroup.querySelector('.chip-btn.is-selected');
  const lhBtn = dom.drawerLhGroup.querySelector('.chip-btn.is-selected');
  const mucusBtn = dom.drawerMucusGroup.querySelector('.chip-btn.is-selected');

  const bbtRaw = dom.drawerBbt.value.trim();
  const bbtNum = bbtRaw === '' ? null : Number(bbtRaw);
  const bbt = bbtNum !== null && Number.isFinite(bbtNum) && bbtNum >= 34 && bbtNum <= 42
    ? Number(bbtNum.toFixed(2))
    : null;

  const note = dom.drawerNote.value.trim();

  const entry = { flow };
  if (symptoms.length > 0) entry.symptoms = symptoms;
  if (moodBtn) entry.mood = moodBtn.dataset.mood;
  if (lhBtn) entry.lhTest = lhBtn.dataset.lh;
  if (mucusBtn) entry.cervicalMucus = mucusBtn.dataset.mucus;
  if (bbt !== null) entry.bbt = bbt;
  if (note.length > 0) entry.note = note;

  return entry;
}

function openLogDrawer(isoDate = uiState.selectedDate) {
  if (!isVaultUnlocked()) return;
  populateDrawer(isoDate);

  if (uiState.drawerOpen) return;
  uiState.drawerOpen = true;
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
  }, 320);
}

function initDrawer() {
  dom.logDrawer.inert = true;

  dom.btnQuickLog.addEventListener('click', () => openLogDrawer(uiState.selectedDate));
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

  // Segmented flow selector
  dom.drawerFlowGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-flow]');
    if (!btn) return;
    dom.drawerFlowGroup.querySelectorAll('.seg-btn').forEach((b) => {
      const active = b === btn;
      b.classList.toggle('seg-btn--active', active);
      b.setAttribute('aria-checked', String(active));
    });
  });

  // Multi-select symptoms
  dom.drawerSymptomsGroup.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-symptom]');
    if (!btn) return;
    const selected = btn.classList.toggle('is-selected');
    btn.setAttribute('aria-pressed', String(selected));
  });

  // Single-select mood, LH, and mucus groups
  [dom.drawerMoodGroup, dom.drawerLhGroup, dom.drawerMucusGroup].forEach((group) => {
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('.chip-btn');
      if (!btn) return;
      const wasSelected = btn.classList.contains('is-selected');
      group.querySelectorAll('.chip-btn').forEach((b) => {
        b.classList.remove('is-selected');
        b.setAttribute('aria-pressed', 'false');
      });
      if (!wasSelected) {
        btn.classList.add('is-selected');
        btn.setAttribute('aria-pressed', 'true');
      }
    });
  });

  dom.btnSaveLog.addEventListener('click', async () => {
    if (!isVaultUnlocked() || dom.btnSaveLog.disabled) return;

    const bbtRaw = dom.drawerBbt.value.trim();
    if (bbtRaw !== '') {
      const bbtNum = Number(bbtRaw);
      if (!Number.isFinite(bbtNum) || bbtNum < 34 || bbtNum > 42) {
        showToast('BBT must be between 34.0 and 42.0 °C');
        dom.drawerBbt.focus();
        return;
      }
    }

    const dateKey = uiState.drawerDate;
    const entry = collectDrawerEntry();
    const isNowBleeding = BLEEDING_FLOWS.has(entry.flow);

    dom.btnSaveLog.disabled = true;
    try {
      await commitVaultState((draft) => {
        const prevEntry = draft.dailyLogs[dateKey];
        const wasBleeding =
          BLEEDING_FLOWS.has(prevEntry?.flow) ||
          Boolean(uiState.latestForecast?.calendarMap?.[dateKey]?.isLoggedPeriod);
        const removedFlowDates = wasBleeding && !isNowBleeding ? [dateKey] : [];

        if (isLogEmpty(entry)) {
          delete draft.dailyLogs[dateKey];
        } else {
          draft.dailyLogs[dateKey] = entry;
        }

        draft.cycles = rebuildCyclesFromLogs(draft.dailyLogs, draft.cycles, {
          removedFlowDates,
        });
      });
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
   11. Boot
   ========================================================================== */
async function boot() {
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
  configurePinGateUI();
}

boot();
