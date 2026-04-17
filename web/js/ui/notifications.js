/**
 * notifications.js -- Local push notifications for urgent needs
 *
 * When a need drops below the critical threshold AND the tab is hidden,
 * fire a native OS notification. Heavily debounced to avoid spam.
 *
 * Uses the Notification API (no server, no VAPID) — sufficient while the
 * browser or PWA is backgrounded. For notifications with the app fully
 * closed, we'd need a Service Worker + Web Push, which is out of scope.
 */
import { Pet } from '../pet/pet.js';
import { NeedType, NEED_NAMES } from '../pet/needs.js';

const STORAGE_KEY = 'lalien_notif_enabled';
const COOLDOWN_MS = 15 * 60 * 1000;  // 15 min per need — don't nag
const CHECK_EVERY_MS = 60 * 1000;    // check once per minute
const THRESHOLD_CRIT = 15;
const THRESHOLD_WARN = 25;

const NEED_LABELS = {
    0: { icon: '🍎', short: 'Ha fame',        critical: 'Il tuo Lalìen sta morendo di fame' },
    1: { icon: '💤', short: 'È esausto',      critical: 'Il tuo Lalìen non ce la fa più' },
    2: { icon: '💧', short: 'È sporco',       critical: 'Miska bassissima, sta per ammalarsi' },
    3: { icon: '😢', short: 'È triste',       critical: 'Il tuo Lalìen è profondamente infelice' },
    4: { icon: '❤',  short: 'Sta male',       critical: 'La sua salute è critica' },
    5: { icon: '🧠', short: 'Mente spenta',   critical: 'La sua mente si sta spegnendo' },
    6: { icon: '🫂', short: 'Si sente solo',  critical: 'Si sente abbandonato' },
    7: { icon: '👁', short: 'È annoiato',     critical: 'Curiosità al minimo' },
    8: { icon: '✨', short: 'Perde la luce',  critical: 'Connessione cosmica svanita' },
    9: { icon: '🛡', short: 'Ha paura',       critical: 'Sicurezza ai minimi' },
};

const _lastFired = new Map();   // needIndex → timestamp
let _timer = null;
let _started = false;

function isIOS() {
    const ua = navigator.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && 'ontouchend' in document);
}
function isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
        || window.navigator.standalone === true;
}

function permission() {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission;
}

function isEnabled() {
    return localStorage.getItem(STORAGE_KEY) === '1';
}

function canFire() {
    if (!isEnabled()) return false;
    if (permission() !== 'granted') return false;
    if (!document.hidden) return false;                 // only when tab backgrounded
    if (!Pet || !Pet.isAlive || !Pet.isAlive()) return false;
    if (Pet.isEgg && Pet.isEgg()) return false;
    return true;
}

async function showViaSW(title, options) {
    try {
        if (!('serviceWorker' in navigator)) return false;
        const reg = await navigator.serviceWorker.ready;
        if (!reg || !reg.showNotification) return false;
        await reg.showNotification(title, options);
        return true;
    } catch (_) { return false; }
}

async function fireForNeed(idx, value) {
    const info = NEED_LABELS[idx];
    if (!info) return;
    const now = Date.now();
    const last = _lastFired.get(idx) || 0;
    if (now - last < COOLDOWN_MS) return;
    _lastFired.set(idx, now);

    const severity = value < THRESHOLD_CRIT ? 'critical' : 'warn';
    const title = severity === 'critical'
        ? `${info.icon} ${info.critical}`
        : `${info.icon} ${Pet.getName ? Pet.getName() : 'Il tuo Lalìen'} — ${info.short}`;
    const body = severity === 'critical'
        ? `Torna subito: ${Math.round(value)}% di ${NEED_NAMES[idx]}.`
        : `Servirebbero cure: ${NEED_NAMES[idx]} a ${Math.round(value)}%.`;

    const opts = {
        body,
        tag: 'lalien-need-' + idx,
        renotify: severity === 'critical',
        silent: severity !== 'critical',
        requireInteraction: severity === 'critical',
        icon: './icon-192.svg',
        badge: './icon-192.svg',
    };

    // Prefer the Service Worker path (REQUIRED on iOS PWA, also works on desktop)
    if (await showViaSW(title, opts)) return;

    // Fallback to direct Notification() on browsers that support it in the page
    try {
        const n = new Notification(title, opts);
        n.onclick = () => { window.focus(); n.close(); };
    } catch (_) { /* ignore */ }
}

function tick() {
    if (!canFire()) return;
    // Sort by severity: most urgent first
    let worst = -1, worstVal = 100;
    for (let i = 0; i < NeedType.COUNT; i++) {
        const v = Pet.needs[i];
        if (v < THRESHOLD_WARN && v < worstVal) { worst = i; worstVal = v; }
    }
    if (worst >= 0) fireForNeed(worst, worstVal);
}

async function requestPermission() {
    // iOS Safari exposes the Notification API ONLY when the PWA is installed
    // to the home screen. In a regular browser tab the API is missing.
    if (!('Notification' in window)) {
        return isIOS() && !isStandalone() ? 'ios-needs-install' : 'unsupported';
    }
    if (Notification.permission === 'denied') return 'denied';
    if (Notification.permission === 'granted') return 'granted';
    try {
        const r = await Notification.requestPermission();
        return r;
    } catch (e) {
        return 'denied';
    }
}

export const Notifications = {
    /** Called once at app startup */
    init() {
        if (_started) return;
        _started = true;
        // If user had notifications enabled but browser revoked, auto-disable
        if (isEnabled() && permission() !== 'granted') {
            localStorage.setItem(STORAGE_KEY, '0');
        }
        clearInterval(_timer);
        _timer = setInterval(tick, CHECK_EVERY_MS);
        // Also fire immediately when tab becomes hidden (fresh state)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) setTimeout(tick, 2000);
        });
    },

    /** User toggled the "Notifiche bisogni" switch in settings */
    async setEnabled(enabled) {
        if (enabled) {
            const res = await requestPermission();
            if (res === 'granted') {
                localStorage.setItem(STORAGE_KEY, '1');
                return { ok: true };
            }
            localStorage.setItem(STORAGE_KEY, '0');
            return { ok: false, reason: res };  // 'denied' | 'unsupported' | 'default'
        } else {
            localStorage.setItem(STORAGE_KEY, '0');
            return { ok: true };
        }
    },

    isEnabled,
    permission,
    isIOS,
    isStandalone,
    needsInstallOnIOS() { return isIOS() && !isStandalone() && !('Notification' in window); },

    /** Force-check — useful right after an action in case tab got backgrounded */
    checkNow() { tick(); },

    /** Send a one-shot test notification to confirm the channel works */
    async test() {
        if (permission() !== 'granted') return false;
        const title = '🛸 Lalìen — test notifica';
        const opts = {
            body: 'Perfetto! Ti avviserò quando il tuo Lalìen avrà bisogno di te.',
            tag: 'lalien-test',
            icon: './icon-192.svg',
            badge: './icon-192.svg',
        };
        if (await showViaSW(title, opts)) return true;
        try { new Notification(title, opts); return true; } catch (_) { return false; }
    },
};
