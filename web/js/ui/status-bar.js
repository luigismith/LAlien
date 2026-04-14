/**
 * status-bar.js -- Pet name, stage, needs chips, time
 * Mobile-first: compact emoji chips with color-coded level ring
 */
import { Pet } from '../pet/pet.js';
import { NeedType, NEED_NAMES, NEED_COLORS } from '../pet/needs.js';
import { I18n } from '../i18n/i18n.js';
import { SoundEngine } from '../audio/sound-engine.js';

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
            chip.className = 'need-chip';
            chip.type = 'button';
            chip.setAttribute('aria-label', NEED_NAMES[i]);
            chip.innerHTML = `
                <span class="need-chip-icon">${NEED_ICONS[i]}</span>
                <span class="need-chip-ring" style="--need-color:${NEED_COLORS[i]}"></span>
            `;
            chip.addEventListener('click', () => this._showNeedDetail(i));
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
        const hours = Pet.getAgeHours() % 24;
        document.getElementById('status-age').textContent =
            days > 0 ? `${days}d ${hours}h` : `${hours}h`;

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

    _showNeedDetail(i) {
        const v = Math.round(Pet.needs[i]);
        const name = I18n.get('need_' + NEED_NAMES[i]);
        if (navigator.vibrate) navigator.vibrate(8);
        SoundEngine.playNeedTap(v, i);
        import('../engine/game-loop.js').then(m => {
            m.showToast(`${NEED_ICONS[i]} ${name}: ${v}% — ${NEED_HINTS[i]}`, 4000);
        });
    },
};
