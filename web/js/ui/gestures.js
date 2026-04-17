/**
 * gestures.js -- Natural gesture layer
 *
 * - DRAG any action button onto the pet → performs that action ("porgere cibo", etc.)
 * - SHAKE the device → opens the play/minigame selector
 * - (Circular scrub over the pet is handled in interactions.js and fires 'pet-scrub')
 *
 * Emits:
 *   gesture-action  { action }   — drag of btn-<action> released over pet canvas
 *   gesture-shake                — device shaken (debounced)
 */
import { Events } from '../engine/events.js';

// ---------------------------------------------------------------------------
// Drag any .btn-action onto the pet canvas → fires gesture-action
// ---------------------------------------------------------------------------
const DRAG_HOLD_MS = 140;       // how long to hold before drag "commits"
const DRAG_MIN_DIST = 14;       // or how far to move before drag commits

function targetRect() {
    const c = document.getElementById('game-canvas');
    if (!c) return null;
    return c.getBoundingClientRect();
}

function isOverPetZone(x, y) {
    // Use the actual pet sprite position from Interactions module,
    // not the whole canvas. This way dropping AWAY from the pet spawns
    // an item, while dropping ON the pet triggers the direct action.
    try {
        const { Interactions } = window._gestureInteractionsRef || {};
        if (Interactions) {
            const pos = Interactions.getCursorPos();  // just to confirm module is alive
            const st = Interactions._getState ? Interactions._getState() : null;
            if (st) {
                const canvas = document.getElementById('game-canvas');
                if (!canvas) return false;
                const rect = canvas.getBoundingClientRect();
                const scaleX = canvas.width / rect.width;
                const scaleY = canvas.height / rect.height;
                const cx = st.petCx / scaleX + rect.left;
                const cy = st.petCy / scaleY + rect.top;
                const r  = (st.petRadius * 2.2) / Math.min(scaleX, scaleY);  // generous but not whole-canvas
                const dist = Math.hypot(x - cx, y - cy);
                return dist < r;
            }
        }
    } catch (_) {}
    // Fallback: small center zone
    const r = targetRect();
    if (!r) return false;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height * 0.55;
    const radius = Math.min(r.width, r.height) * 0.18;
    return Math.hypot(x - cx, y - cy) < radius;
}

function pointer(e) {
    if (e.touches && e.touches[0]) return e.touches[0];
    if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0];
    return e;
}

function attachDraggable(btn) {
    const action = btn.dataset.action;
    if (!action) return;
    if (action === 'settings') return;  // settings stays click-only

    let ghost = null;
    let startX = 0, startY = 0;
    let active = false;          // drag committed
    let pressed = false;
    let commitTimer = null;
    let suppressClick = false;

    const commitDrag = (x, y) => {
        if (active) return;
        active = true;
        ghost = document.createElement('div');
        ghost.className = 'action-ghost';
        const icon = btn.querySelector('.action-icon') || btn.querySelector('.need-chip-icon');
        // Hotbar slots have the emoji directly as text content (no child)
        const directText = btn.classList.contains('hotbar-slot') ? btn.textContent.trim() : '';
        ghost.textContent = icon ? icon.textContent : (directText || '•');
        document.body.appendChild(ghost);
        ghost.style.left = x + 'px';
        ghost.style.top = y + 'px';
        if (navigator.vibrate) navigator.vibrate(12);
        btn.classList.add('dragging-source');
    };

    const onDown = (e) => {
        const p = pointer(e);
        startX = p.clientX; startY = p.clientY;
        pressed = true; active = false; suppressClick = false;
        clearTimeout(commitTimer);
        commitTimer = setTimeout(() => {
            if (pressed && !active) commitDrag(startX, startY);
        }, DRAG_HOLD_MS);
    };

    const onMove = (e) => {
        if (!pressed) return;
        const p = pointer(e);
        if (!active) {
            const d = Math.hypot(p.clientX - startX, p.clientY - startY);
            if (d > DRAG_MIN_DIST) commitDrag(p.clientX, p.clientY);
        }
        if (active) {
            e.preventDefault();
            ghost.style.left = p.clientX + 'px';
            ghost.style.top = p.clientY + 'px';
            if (isOverPetZone(p.clientX, p.clientY)) {
                ghost.classList.add('on-target');
            } else {
                ghost.classList.remove('on-target');
            }
        }
    };

    const onUp = (e) => {
        clearTimeout(commitTimer);
        if (!pressed) return;
        pressed = false;
        if (active) {
            const p = pointer(e);
            const onTarget = isOverPetZone(p.clientX, p.clientY);
            // Detect drop on the canvas but NOT on the pet → spawn an item
            const canvas = document.getElementById('game-canvas');
            let onFloor = false;
            if (canvas && !onTarget) {
                const r = canvas.getBoundingClientRect();
                if (p.clientX >= r.left && p.clientX <= r.right && p.clientY >= r.top && p.clientY <= r.bottom) {
                    onFloor = true;
                    // Translate client coords → virtual canvas space
                    const vx = (p.clientX - r.left) * (canvas.width / r.width);
                    const vy = (p.clientY - r.top) * (canvas.height / r.height);
                    import('../engine/items.js').then(m => {
                        m.Items.spawn(action, vx, vy);
                    }).catch(() => {});
                }
            }
            if (ghost) {
                if (onTarget || onFloor) {
                    ghost.classList.add('delivered');
                    setTimeout(() => ghost && ghost.remove(), 200);
                } else {
                    ghost.classList.add('returning');
                    setTimeout(() => ghost && ghost.remove(), 220);
                }
                ghost = null;
            }
            btn.classList.remove('dragging-source');
            active = false;
            suppressClick = true;
            if (onTarget) {
                if (navigator.vibrate) navigator.vibrate([8, 18, 10]);
                Events.emit('gesture-action', { action });
            } else if (onFloor) {
                if (navigator.vibrate) navigator.vibrate([6, 12, 6]);
            }
        }
    };

    // Block taps: for hotbar slots, clicks should NEVER trigger a direct action
    // (only drag-to-floor or drag-to-pet). For chips/buttons, allow click-through.
    const isHotbarSlot = btn.classList.contains('hotbar-slot');
    btn.addEventListener('click', (e) => {
        if (suppressClick || isHotbarSlot) {
            suppressClick = false;
            e.preventDefault();
            e.stopPropagation();
        }
    }, true);

    btn.addEventListener('touchstart', onDown, { passive: true });
    btn.addEventListener('touchmove',  onMove, { passive: false });
    btn.addEventListener('touchend',   onUp);
    btn.addEventListener('touchcancel', onUp);
    btn.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
}

function initDragActions() {
    const buttons = document.querySelectorAll('#action-bar .btn-action[data-action]');
    buttons.forEach(attachDraggable);
    // Chips in the status bar are also draggable
    const chips = document.querySelectorAll('#status-needs-dots .need-chip.actionable[data-action]');
    chips.forEach(attachDraggable);
    // Hotbar inventory slots — same drag logic, action comes from data-item
    const slots = document.querySelectorAll('#hotbar .hotbar-slot[data-item]');
    slots.forEach(s => {
        s.dataset.action = s.dataset.item;  // map so existing attachDraggable works
        attachDraggable(s);
    });
}

// ---------------------------------------------------------------------------
// Shake detection → gesture-shake (debounced)
// ---------------------------------------------------------------------------
const SHAKE_THRESHOLD = 22;       // m/s² peak over gravity-including accel
const SHAKE_COOLDOWN  = 1200;
let _lastShake = 0;
let _shakeBound = false;

function bindShake() {
    if (_shakeBound) return;
    _shakeBound = true;
    window.addEventListener('devicemotion', (e) => {
        const a = e.accelerationIncludingGravity || e.acceleration;
        if (!a) return;
        const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
        // accelerationIncludingGravity baseline ≈ 9.8; shake spikes well above
        if (mag > SHAKE_THRESHOLD) {
            const now = Date.now();
            if (now - _lastShake > SHAKE_COOLDOWN) {
                _lastShake = now;
                if (navigator.vibrate) navigator.vibrate([10, 30, 10, 30]);
                Events.emit('gesture-shake');
            }
        }
    });
}

function initShake() {
    if (!window.DeviceMotionEvent) return;
    // iOS 13+ requires an explicit permission prompt triggered by a user gesture.
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const once = async () => {
            document.removeEventListener('touchend', once);
            document.removeEventListener('click', once);
            try {
                const r = await DeviceMotionEvent.requestPermission();
                if (r === 'granted') bindShake();
            } catch (_) { /* user declined */ }
        };
        document.addEventListener('touchend', once, { once: true });
        document.addEventListener('click',   once, { once: true });
    } else {
        bindShake();
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export const Gestures = {
    init() {
        // Store ref to Interactions for pet-zone hit testing
        import('./interactions.js').then(m => {
            window._gestureInteractionsRef = m;
        }).catch(() => {});
        initDragActions();
        initShake();
    }
};
