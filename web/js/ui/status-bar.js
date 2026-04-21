/**
 * status-bar.js -- Pet name, stage, needs chips, time
 * Mobile-first: compact emoji chips with color-coded level ring
 */
import { Pet } from '../pet/pet.js';
import { NeedType, NEED_NAMES, NEED_COLORS } from '../pet/needs.js';
import { I18n } from '../i18n/i18n.js';
import { SoundEngine } from '../audio/sound-engine.js';
import { Events } from '../engine/events.js';

// Each need maps to a primary action (or null if purely informational).
// KORA→feed, MOKO→sleep, MISKA→clean, NASHI→play, HEALTH→info,
// COGNITION→talk, AFFECTION→caress, CURIOSITY→play, COSMIC→meditate, SECURITY→info
const NEED_ACTION = [
    'feed', 'sleep', 'clean', 'play', null,
    'talk', 'caress', 'play', 'meditate', null,
];

const NEED_ICONS = [
    '🍎',  // KORA - hunger
    '💤',  // MOKO - rest
    '💧',  // MISKA - hygiene
    '😊',  // NASHI - happiness
    '❤',  // HEALTH
    '🧠',  // COGNITION
    '🫂',  // AFFECTION
    '👁',  // CURIOSITY
    '✨',  // COSMIC
    '🛡',  // SECURITY
];

const NEED_HINTS = [
    "Fame. Nutrilo con l'azione Nutri.",
    "Stanchezza. Fallo dormire.",
    "Igiene. Puliscilo quando è sporco.",
    "Felicità. Gioca con lui, coccolalo.",
    "Salute. Si recupera tenendo alti gli altri bisogni.",
    "Mente. Parla con lui per stimolarlo.",
    "Affetto. Accarezzalo, parla con lui.",
    "Curiosità. Varia le attività, sorprendilo.",
    "Cosmico. Medita insieme (stadi avanzati).",
    "Sicurezza. Presenza costante e routine lo rassicurano.",
];

// Richer, contextual text shown in the tap popover
const NEED_TITLES = [
    'Fame (Kòra)', 'Stanchezza (Mokó)', 'Igiene (Miska)', 'Felicità (Nashi)',
    'Salute', 'Mente (Cognition)', 'Affetto', 'Curiosità',
    'Cosmico', 'Sicurezza',
];
const NEED_ADVICE = [
    // 0 KORA
    { ok: 'È sazio e sereno.',        mid: 'Comincia ad avere un po\' di fame.',      bad: 'Ha fame. Dagli da mangiare ora.',                 action: 'feed',     cta: '🍎 Nutri' },
    // 1 MOKO
    { ok: 'È riposato.',               mid: 'Sta diventando stanco.',                   bad: 'È esausto. Mettilo a dormire.',                    action: 'sleep',    cta: '💤 Dormi' },
    // 2 MISKA
    { ok: 'È pulito.',                 mid: 'Si sta sporcando.',                        bad: 'È sporco. Puliscilo subito.',                      action: 'clean',    cta: '💧 Pulisci' },
    // 3 NASHI
    { ok: 'È felice.',                 mid: 'Si annoia.',                               bad: 'È triste. Gioca con lui o coccolalo.',             action: 'play',     cta: '🎮 Gioca' },
    // 4 HEALTH
    { ok: 'Sta benissimo.',            mid: 'Un po\' fiacco. Tieni alti gli altri bisogni.', bad: 'Sta male. Rialza fame, igiene, affetto.',    action: null,       cta: null },
    // 5 COGNITION
    { ok: 'La mente è sveglia.',       mid: 'Vuole essere stimolato.',                  bad: 'La sua mente si spegne. Parla con lui.',           action: 'talk',     cta: '💬 Parla' },
    // 6 AFFECTION
    { ok: 'Si sente amato.',           mid: 'Vorrebbe una carezza.',                    bad: 'Si sente solo. Accarezzalo.',                      action: 'caress',   cta: '🫂 Coccola' },
    // 7 CURIOSITY
    { ok: 'È curioso del mondo.',      mid: 'Cerca novità.',                            bad: 'È apatico. Prova un\'attività diversa.',           action: 'play',     cta: '🎮 Sorprendi' },
    // 8 COSMIC
    { ok: 'La sua luce cosmica brilla.', mid: 'La connessione cosmica vacilla.',        bad: 'Sta perdendo la luce. Meditate insieme.',          action: 'meditate', cta: '✨ Medita' },
    // 9 SECURITY
    { ok: 'Si fida di te.',            mid: 'Un po\' insicuro.',                        bad: 'Ha paura. Resta presente e calmo, parlagli dolcemente.', action: null, cta: null },
];

function stateLabel(v) {
    if (v >= 70) return { word: 'Ottimo',    cls: 'ok',       adviceKey: 'ok'  };
    if (v >= 40) return { word: 'Stabile',   cls: 'warn',     adviceKey: 'mid' };
    if (v >= 20) return { word: 'In calo',   cls: 'bad',      adviceKey: 'bad' };
    return          { word: 'Critico',    cls: 'critical', adviceKey: 'bad' };
}

let _initialized = false;
let _chips = [];

function levelClass(v) {
    if (v >= 70) return 'ok';
    if (v >= 40) return 'warn';
    if (v >= 20) return 'bad';
    return 'critical';
}

export const StatusBar = {
    init() {
        if (_initialized) return;
        _initialized = true;

        // Build chip row
        const container = document.getElementById('status-needs-dots');
        container.innerHTML = '';
        container.classList.add('needs-chips');
        _chips = [];
        for (let i = 0; i < NeedType.COUNT; i++) {
            const chip = document.createElement('button');
            const action = NEED_ACTION[i];
            chip.className = 'need-chip' + (action ? ' actionable' : '');
            chip.type = 'button';
            chip.dataset.needIndex = String(i);
            if (action) chip.dataset.action = action;
            chip.setAttribute('aria-label', NEED_NAMES[i] + (action ? ` — ${action}` : ''));
            chip.innerHTML = `
                <span class="need-chip-icon">${NEED_ICONS[i]}</span>
                <span class="need-chip-ring" style="--need-color:${NEED_COLORS[i]}"></span>
            `;
            this._bindChipGestures(chip, i, action);
            container.appendChild(chip);
            _chips.push(chip);
        }

        // Build full bars in overlay
        const barsContainer = document.getElementById('needs-bars');
        barsContainer.innerHTML = '';
        for (let i = 0; i < NeedType.COUNT; i++) {
            const row = document.createElement('div');
            row.className = 'need-card';
            row.innerHTML = `
                <span class="need-card-icon">${NEED_ICONS[i]}</span>
                <div class="need-card-body">
                    <div class="need-card-head">
                        <span class="need-card-label">${I18n.get('need_' + NEED_NAMES[i])}</span>
                        <span class="need-card-value" id="need-val-${i}">100</span>
                    </div>
                    <div class="need-card-track">
                        <div class="need-card-fill" id="need-fill-${i}" style="background:${NEED_COLORS[i]};width:100%"></div>
                    </div>
                    <p class="need-card-hint">${NEED_HINTS[i]}</p>
                </div>
            `;
            barsContainer.appendChild(row);
        }
    },

    update() {
        if (!_initialized) return;

        document.getElementById('status-name').textContent = Pet.getName() || Pet.getStageName();
        document.getElementById('status-stage').textContent = Pet.getStageName();

        const days = Pet.getAgeDays();
        const hours = Pet.getAgeHoursDisplay() % 24;
        const minutes = Pet.getAgeMinutes() % 60;
        const ageStr = days > 0 ? `${days}d ${hours}h` : (hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`);
        document.getElementById('status-age').textContent = ageStr;

        let criticalCount = 0;
        for (let i = 0; i < NeedType.COUNT; i++) {
            const v = Pet.needs[i];
            const chip = _chips[i];
            if (!chip) continue;
            chip.classList.remove('ok','warn','bad','critical');
            chip.classList.add(levelClass(v));
            chip.style.setProperty('--level', Math.max(5, v) + '%');
            if (v < 20) criticalCount++;
        }

        // Expand button badge
        const expand = document.getElementById('btn-needs-expand');
        if (expand) {
            expand.dataset.critical = criticalCount > 0 ? String(criticalCount) : '';
            expand.classList.toggle('has-alerts', criticalCount > 0);
        }

        // Full bars
        for (let i = 0; i < NeedType.COUNT; i++) {
            const v = Math.round(Pet.needs[i]);
            const fill = document.getElementById(`need-fill-${i}`);
            const valEl = document.getElementById(`need-val-${i}`);
            if (fill) {
                fill.style.width = v + '%';
                fill.parentElement.classList.remove('ok','warn','bad','critical');
                fill.parentElement.classList.add(levelClass(v));
            }
            if (valEl) valEl.textContent = v;
        }
    },

    toggleNeedsOverlay() {
        const overlay = document.getElementById('needs-overlay');
        overlay.classList.toggle('hidden');
        if (!overlay.classList.contains('hidden')) {
            this.update();
        }
    },

    /**
     * Rich popover anchored to the tapped chip: shows state, percentage,
     * contextual advice and a CTA button to run the satisfying action.
     */
    _showNeedDetail(i, anchorEl) {
        const v = Math.round(Pet.needs[i]);
        const state = stateLabel(v);
        const advice = NEED_ADVICE[i];
        const titleText = NEED_TITLES[i];
        const msg = advice[state.adviceKey];
        const actionable = !!advice.action && Pet.isAlive && Pet.isAlive() && !(Pet.isEgg && Pet.isEgg());
        const stageOk   = advice.action !== 'meditate' || (Pet.getStage && Pet.getStage() >= 6);

        if (navigator.vibrate) navigator.vibrate(8);
        SoundEngine.playNeedTap(v, i);

        // Remove any existing popover
        document.querySelectorAll('.need-popover').forEach(p => p.remove());

        const pop = document.createElement('div');
        pop.className = `need-popover state-${state.cls}`;
        pop.setAttribute('role', 'dialog');
        pop.innerHTML = `
            <div class="need-popover-head">
                <span class="need-popover-icon" aria-hidden="true">${NEED_ICONS[i]}</span>
                <div class="need-popover-title">
                    <div class="need-popover-name">${titleText}</div>
                    <div class="need-popover-state ${state.cls}">${state.word} · ${v}%</div>
                </div>
                <button class="need-popover-close" aria-label="Chiudi">&times;</button>
            </div>
            <div class="need-popover-track"><div class="need-popover-fill" style="width:${Math.max(4,v)}%;background:${NEED_COLORS[i]}"></div></div>
            <p class="need-popover-msg">${msg}</p>
            ${actionable && stageOk ? `<button class="need-popover-cta" data-pop-action="${advice.action}">${advice.cta}</button>` : ''}
            ${advice.action === 'meditate' && !stageOk ? `<p class="need-popover-note">Sarà possibile meditare quando crescerà (dallo stadio Lali-mere).</p>` : ''}
            ${actionable && stageOk ? `<p class="need-popover-hint">Suggerimento: puoi anche <b>trascinare</b> questo cerchio sul Lalìen.</p>` : ''}
        `;
        document.body.appendChild(pop);

        // Position below the chip, clamped to viewport
        const rect = (anchorEl || _chips[i]).getBoundingClientRect();
        const margin = 8;
        const popW = Math.min(280, window.innerWidth - 2 * margin);
        pop.style.width = popW + 'px';
        const cx = rect.left + rect.width / 2;
        let left = Math.max(margin, Math.min(cx - popW / 2, window.innerWidth - popW - margin));
        pop.style.left = left + 'px';
        pop.style.top  = (rect.bottom + 10) + 'px';
        // Small arrow pointing up to the chip
        pop.style.setProperty('--arrow-x', (cx - left) + 'px');
        pop.classList.add('visible');

        const close = () => {
            pop.classList.remove('visible');
            setTimeout(() => pop.remove(), 180);
            document.removeEventListener('click', outside, true);
        };
        const outside = (ev) => {
            if (pop.contains(ev.target) || (anchorEl && anchorEl.contains(ev.target))) return;
            close();
        };
        pop.querySelector('.need-popover-close').addEventListener('click', close);
        const cta = pop.querySelector('.need-popover-cta');
        if (cta) {
            cta.addEventListener('click', () => {
                close();
                Events.emit('gesture-action', { action: cta.dataset.popAction, source: 'popover' });
                if (navigator.vibrate) navigator.vibrate([8, 18, 10]);
            });
        }
        // Close on outside tap (deferred so the triggering tap doesn't immediately close it)
        setTimeout(() => document.addEventListener('click', outside, true), 10);
        // Auto-dismiss after a while so an idle chat doesn't leave it stuck
        setTimeout(() => pop.classList.contains('visible') && close(), 12000);
    },

    // Short-tap  → rich info popover (with CTA to perform the action)
    // Long-press → quick direct action (power-user shortcut)
    // Drag       → action via Gestures layer
    _bindChipGestures(chip, i, action) {
        let longPressTimer = null;
        let longPressFired = false;

        const onDown = () => {
            longPressFired = false;
            clearTimeout(longPressTimer);
            if (!action) return;  // non-actionable chips have no shortcut
            longPressTimer = setTimeout(() => {
                if (!Pet.isAlive || !Pet.isAlive()) return;
                if (Pet.isEgg && Pet.isEgg()) return;
                longPressFired = true;
                if (navigator.vibrate) navigator.vibrate([10, 20, 10]);
                Events.emit('gesture-action', { action, source: 'chip-longpress' });
            }, 620);
        };
        const onCancel = () => { clearTimeout(longPressTimer); };

        chip.addEventListener('touchstart', onDown, { passive: true });
        chip.addEventListener('mousedown',  onDown);
        chip.addEventListener('touchend',   onCancel);
        chip.addEventListener('touchcancel', onCancel);
        chip.addEventListener('mouseup',    onCancel);
        chip.addEventListener('mouseleave', onCancel);

        chip.addEventListener('click', (e) => {
            clearTimeout(longPressTimer);
            if (longPressFired) { e.preventDefault(); return; }
            // ALWAYS show the info popover on a clean tap
            this._showNeedDetail(i, chip);
        });
    },
};
