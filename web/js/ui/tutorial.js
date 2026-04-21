/**
 * tutorial.js -- Non-invasive contextual hints system
 * - Tips anchored to UI elements
 * - Dismissed once = never shown again (persisted)
 * - Globally disableable from Settings (default: on for first-time users)
 */
import { Events } from '../engine/events.js';
import { Pet } from '../pet/pet.js';

const DISMISSED_KEY = 'lalien_tutorial_dismissed';
const ENABLED_KEY   = 'lalien_tutorial_enabled';

let _dismissed = new Set();
let _queue = [];
let _current = null;
let _initialized = false;

// Tip definitions
// trigger: 'start' | 'hatched' | 'first-action' | 'first-chat' | 'first-mood'
// position: 'top' | 'bottom' | 'left' | 'right' (anchor side where tip appears)
const TIPS = [
    {
        id: 'welcome',
        anchor: '#game-canvas',
        position: 'center',
        trigger: 'start',
        text: "Benvenuto custode. Il tuo uovo-seme ha bisogno di te: toccalo almeno 3 volte e aspetta 24 ore di gioco per schiuderlo.",
    },
    {
        id: 'cloud-icon',
        anchor: '#status-cloud',
        position: 'bottom',
        trigger: 'start',
        delay: 4000,
        text: "Questa è la sincronia col server: verde = salvato, grigio = solo locale. Il tuo account ti segue ovunque.",
    },
    {
        id: 'egg-touch',
        anchor: '#game-canvas',
        position: 'bottom',
        trigger: 'start',
        delay: 8000,
        when: () => Pet.isEgg(),
        text: "Tocca l'uovo per stabilire contatto. Le barre sotto mostrano il progresso di schiusa.",
    },
    {
        id: 'hatched',
        anchor: '#action-bar',
        position: 'top',
        trigger: 'hatched',
        text: "È nato! Qui accudisci il tuo Lalìen: nutri, fai dormire, pulisci, gioca, parla, accarezza, medita. Ogni azione incide sui suoi bisogni.",
    },
    {
        id: 'needs',
        anchor: '#btn-needs-expand',
        position: 'bottom',
        trigger: 'hatched',
        delay: 4000,
        text: "Apri il pannello bisogni (10 indicatori). Se uno cala troppo a lungo, il Lalìen soffre — o peggio.",
    },
    {
        id: 'chat',
        anchor: '[data-action="talk"]',
        position: 'top',
        trigger: 'hatched',
        delay: 8000,
        text: "Parlagli nella tua lingua. Lui risponde nel suo idioma — col tempo imparerà parole tue, e tu le sue.",
    },
    {
        id: 'caress',
        anchor: '#game-canvas',
        position: 'center',
        trigger: 'hatched',
        delay: 12000,
        text: "Trascina orizzontalmente sulla creatura per accarezzarla (4+ movimenti). Apparirà qualche cuoricino ♥.",
    },
    {
        id: 'settings',
        anchor: '[data-action="settings"]',
        position: 'top',
        trigger: 'first-action',
        text: "Impostazioni: cambia lingua, provider AI, velocità del tempo, attiva/disattiva la voce e il tutorial.",
    },
];

// ---- Tooltip DOM ------------------------------------------------------------

function createTooltipEl() {
    let el = document.getElementById('tutorial-tip');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'tutorial-tip';
    el.className = 'tutorial-tip hidden';
    el.innerHTML = `
        <div class="tutorial-tip-text"></div>
        <div class="tutorial-tip-actions">
            <button class="tutorial-tip-close">Ho capito</button>
            <button class="tutorial-tip-disable">Disattiva tutorial</button>
        </div>
    `;
    document.body.appendChild(el);
    el.querySelector('.tutorial-tip-close').addEventListener('click', () => Tutorial._hideCurrent(true));
    el.querySelector('.tutorial-tip-disable').addEventListener('click', () => {
        Tutorial.setEnabled(false);
        Tutorial._hideCurrent(false);
    });
    return el;
}

function positionTip(tip, anchor, pos) {
    const el = createTooltipEl();
    const arect = anchor.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    el.classList.remove('hidden');
    el.style.visibility = 'hidden';
    el.style.display = 'block';
    const w = el.offsetWidth, h = el.offsetHeight;
    let x, y;
    switch (pos) {
        case 'top':
            x = arect.left + arect.width / 2 - w / 2;
            y = arect.top - h - 12;
            break;
        case 'bottom':
            x = arect.left + arect.width / 2 - w / 2;
            y = arect.bottom + 12;
            break;
        case 'left':
            x = arect.left - w - 12;
            y = arect.top + arect.height / 2 - h / 2;
            break;
        case 'right':
            x = arect.right + 12;
            y = arect.top + arect.height / 2 - h / 2;
            break;
        case 'center':
        default:
            x = vw / 2 - w / 2;
            y = vh / 2 - h / 2;
    }
    // Clamp into viewport
    x = Math.max(8, Math.min(vw - w - 8, x));
    y = Math.max(8, Math.min(vh - h - 8, y));
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    el.style.visibility = 'visible';
    el.setAttribute('data-pos', pos);
}

// ---- Public API -------------------------------------------------------------

export const Tutorial = {

    init() {
        if (_initialized) return;
        _initialized = true;
        try {
            const raw = localStorage.getItem(DISMISSED_KEY);
            if (raw) _dismissed = new Set(JSON.parse(raw));
        } catch { _dismissed = new Set(); }
        createTooltipEl();

        // React to pet evolution from egg → larva
        Events.on('evolution', ({ from }) => {
            if (from === 0) this.trigger('hatched');
        });
    },

    isEnabled() {
        return localStorage.getItem(ENABLED_KEY) !== '0';
    },

    setEnabled(v) {
        localStorage.setItem(ENABLED_KEY, v ? '1' : '0');
        if (!v) this._hideCurrent(false);
    },

    resetAll() {
        _dismissed.clear();
        localStorage.removeItem(DISMISSED_KEY);
        localStorage.removeItem(ENABLED_KEY);
    },

    /** Kick off tips matching a trigger. Call whenever an event fires. */
    trigger(triggerName) {
        if (!this.isEnabled()) return;
        const relevant = TIPS.filter(t => t.trigger === triggerName && !_dismissed.has(t.id));
        for (const t of relevant) {
            if (t.when && !t.when()) continue;
            _queue.push(t);
        }
        this._drainQueue();
    },

    _drainQueue() {
        if (_current || _queue.length === 0) return;
        const tip = _queue.shift();
        setTimeout(() => this._show(tip), tip.delay || 0);
    },

    _show(tip) {
        if (!this.isEnabled()) return;
        if (_dismissed.has(tip.id)) { _current = null; this._drainQueue(); return; }
        const anchor = document.querySelector(tip.anchor);
        if (!anchor) { _current = null; this._drainQueue(); return; }

        const el = createTooltipEl();
        el.querySelector('.tutorial-tip-text').textContent = tip.text;
        positionTip(tip, anchor, tip.position);
        _current = tip;
    },

    _hideCurrent(dismiss) {
        const el = document.getElementById('tutorial-tip');
        if (el) el.classList.add('hidden');
        if (dismiss && _current) {
            _dismissed.add(_current.id);
            localStorage.setItem(DISMISSED_KEY, JSON.stringify([..._dismissed]));
        }
        _current = null;
        // Continue queue after a short pause
        setTimeout(() => this._drainQueue(), 400);
    },
};
