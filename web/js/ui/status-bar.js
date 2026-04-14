/**
 * status-bar.js -- Pet name, stage, need dots, time
 */
import { Pet } from '../pet/pet.js';
import { NeedType, NEED_NAMES, NEED_COLORS, Needs } from '../pet/needs.js';
import { I18n } from '../i18n/i18n.js';

let _initialized = false;
let _needDots = [];

export const StatusBar = {
    init() {
        if (_initialized) return;
        _initialized = true;

        // Create need dots
        const container = document.getElementById('status-needs-dots');
        container.innerHTML = '';
        _needDots = [];
        for (let i = 0; i < NeedType.COUNT; i++) {
            const dot = document.createElement('div');
            dot.className = 'need-dot';
            dot.title = NEED_NAMES[i];
            dot.style.backgroundColor = NEED_COLORS[i];
            container.appendChild(dot);
            _needDots.push(dot);
        }

        // Create need bars in overlay
        const barsContainer = document.getElementById('needs-bars');
        barsContainer.innerHTML = '';
        for (let i = 0; i < NeedType.COUNT; i++) {
            const row = document.createElement('div');
            row.className = 'need-bar-row';
            row.innerHTML = `
                <span class="need-bar-label">${I18n.get('need_' + NEED_NAMES[i])}</span>
                <div class="need-bar-track">
                    <div class="need-bar-fill" id="need-fill-${i}" style="background:${NEED_COLORS[i]};width:100%"></div>
                </div>
                <span class="need-bar-value" id="need-val-${i}">100</span>
            `;
            barsContainer.appendChild(row);
        }
    },

    update() {
        if (!_initialized) return;

        // Name and stage
        document.getElementById('status-name').textContent = Pet.getName() || Pet.getStageName();
        document.getElementById('status-stage').textContent = Pet.getStageName();

        // Age
        const days = Pet.getAgeDays();
        const hours = Pet.getAgeHours() % 24;
        document.getElementById('status-age').textContent =
            days > 0 ? `${days}d ${hours}h` : `${hours}h`;

        // Need dots (brightness indicates level)
        for (let i = 0; i < NeedType.COUNT; i++) {
            const val = Pet.needs[i];
            const opacity = 0.2 + (val / 100) * 0.8;
            _needDots[i].style.opacity = opacity;

            // Critical flash
            if (val < 15) {
                _needDots[i].style.animation = 'pulse 1s infinite';
            } else {
                _needDots[i].style.animation = '';
            }
        }

        // Need bars
        for (let i = 0; i < NeedType.COUNT; i++) {
            const val = Math.round(Pet.needs[i]);
            const fill = document.getElementById(`need-fill-${i}`);
            const valEl = document.getElementById(`need-val-${i}`);
            if (fill) fill.style.width = val + '%';
            if (valEl) valEl.textContent = val;
        }
    },

    toggleNeedsOverlay() {
        const overlay = document.getElementById('needs-overlay');
        overlay.classList.toggle('hidden');
        if (!overlay.classList.contains('hidden')) {
            this.update(); // Refresh values when opening
        }
    },
};
