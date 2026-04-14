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
    const r = targetRect();
    if (!r) return false;
    // The "pet zone" is the central area of the canvas — some margin around the sprite.
    const padX = r.width * 0.12;
    const padY = r.height * 0.12;
    return x >= r.left + padX && x <= r.right - padX
        && y >= r.top + padY && y <= r.bottom - padY;
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
        const icon = btn.querySelector('.action-icon');
        ghost.textContent = icon ? icon.textContent : '•';
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
            if (ghost) {
                if (onTarget) {
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
            }
        }
    };

    // Block the tap that fires after a drag
    btn.addEventListener('click', (e) => {
        if (suppressClick) { suppressClick = false; e.preventDefault(); e.stopPropagation(); }
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
    // Chips in the status bar are also draggable — unified UX: every actionable
    // need-chip can be dragged onto the pet ("porgere cibo", "accarezzare"...)
    const chips = document.querySelectorAll('#status-needs-dots .need-chip.actionable[data-action]');
    chips.forEach(attachDraggable);
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
        initDragActions();
        initShake();
    }
};
