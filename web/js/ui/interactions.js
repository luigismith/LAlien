/**
 * interactions.js -- Canvas touch & mouse interaction manager
 * Handles petting, poking, dragging gestures on the pet sprite
 */
import { Events } from '../engine/events.js';

function spawnBubble(x, y) {
    _state.bubbles.push({
        x: x + (Math.random() - 0.5) * 20,
        y: y + (Math.random() - 0.5) * 20,
        vx: (Math.random() - 0.5) * 0.6,
        vy: -0.5 - Math.random() * 0.8,
        life: 1.0,
        size: 4 + Math.random() * 5,
    });
}

function updateScrub(pos) {
    const ax = pos.x - _state.petCx;
    const ay = pos.y - _state.petCy;
    const dist = Math.hypot(ax, ay);
    // Scrub ring: between half-radius and 3× radius around pet center
    if (dist < _state.petRadius * 0.4 || dist > _state.petRadius * 3) {
        _state.scrubLastAngle = null;
        return;
    }
    const ang = Math.atan2(ay, ax);
    if (_state.scrubLastAngle !== null) {
        let da = ang - _state.scrubLastAngle;
        if (da > Math.PI) da -= 2 * Math.PI;
        if (da < -Math.PI) da += 2 * Math.PI;
        // Only count motion in a consistent direction (sign-preserving accumulator)
        _state.scrubAngle += da;
        if (_state.bubbles.length < 30 && Math.random() < 0.3) spawnBubble(pos.x, pos.y);
        if (Math.abs(_state.scrubAngle) > Math.PI * 2) {
            _state.scrubFullRotations++;
            _state.scrubAngle = 0;
            if (navigator.vibrate) navigator.vibrate(10);
            for (let k = 0; k < 6; k++) spawnBubble(pos.x, pos.y);
            if (_state.scrubFullRotations >= 2) {
                _state.scrubFullRotations = 0;
                Events.emit('pet-scrub', { x: pos.x, y: pos.y });
            }
        }
    }
    _state.scrubLastAngle = ang;
}

function resetScrub() {
    _state.scrubAngle = 0;
    _state.scrubLastAngle = null;
    _state.scrubFullRotations = 0;
}

// Interaction state
const _state = {
    // Mouse / touch position in canvas coords
    x: 0, y: 0,
    isDown: false,
    isDragging: false,
    dragStartX: 0, dragStartY: 0,
    dragDist: 0,
    lastMoveTime: 0,
    moveSpeed: 0,
    // Petting accumulator (gesture = fast horizontal strokes over pet)
    petStrokes: 0,
    lastStrokeDir: 0,
    strokeTimer: 0,
    // Pet hit area
    petCx: 400, petCy: 240, petRadius: 50,
    // Heart particles on petting
    hearts: [],
    // Poke ripple
    ripples: [],
    // Idle cursor tracking for eyes
    cursorActive: false,
    cursorFadeTimer: 0,
    // Circular scrub (pulizia) — cumulative angle around pet center
    scrubAngle: 0,
    scrubLastAngle: null,
    scrubFullRotations: 0,
    bubbles: [],
};

function canvasCoords(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
    };
}

function isOverPet(x, y) {
    const dx = x - _state.petCx;
    const dy = y - _state.petCy;
    return (dx * dx + dy * dy) < (_state.petRadius * _state.petRadius * 2.5);
}

function spawnHeart(x, y) {
    _state.hearts.push({
        x: x + (Math.random() - 0.5) * 30,
        y: y - 10,
        vx: (Math.random() - 0.5) * 1.5,
        vy: -1 - Math.random() * 1.5,
        life: 1.0,
        size: 6 + Math.random() * 6,
    });
}

function spawnRipple(x, y) {
    // Double ring for stronger visual feedback
    _state.ripples.push({ x, y, radius: 5, maxRadius: 55 + Math.random() * 15, life: 1.0 });
    _state.ripples.push({ x, y, radius: 2, maxRadius: 35 + Math.random() * 10, life: 1.0 });
}

export const Interactions = {
    /** Expose state for pet-zone hit testing from gestures.js */
    _getState() { return _state; },
    init(canvas) {
        // Mouse events
        canvas.addEventListener('mousedown', (e) => {
            const pos = canvasCoords(canvas, e);
            _state.isDown = true;
            _state.isDragging = false;
            _state.dragStartX = pos.x;
            _state.dragStartY = pos.y;
            _state.dragDist = 0;
            _state.x = pos.x;
            _state.y = pos.y;
            _state.cursorActive = true;
            _state.cursorFadeTimer = 300;
        });

        canvas.addEventListener('mousemove', (e) => {
            const pos = canvasCoords(canvas, e);
            const dx = pos.x - _state.x;
            const now = performance.now();
            const dt = now - _state.lastMoveTime;
            _state.moveSpeed = dt > 0 ? Math.abs(dx) / dt * 16 : 0;
            _state.x = pos.x;
            _state.y = pos.y;
            _state.lastMoveTime = now;
            _state.cursorActive = true;
            _state.cursorFadeTimer = 300;

            if (_state.isDown) {
                _state.dragDist += Math.abs(dx);
                if (_state.dragDist > 10) _state.isDragging = true;

                if (_state.isDragging) updateScrub(pos);

                // Detect petting strokes (horizontal movement over pet)
                if (isOverPet(pos.x, pos.y) && _state.isDragging) {
                    const dir = dx > 0 ? 1 : -1;
                    if (dir !== _state.lastStrokeDir && _state.lastStrokeDir !== 0) {
                        _state.petStrokes++;
                        if (_state.petStrokes % 3 === 0) {
                            spawnHeart(pos.x, pos.y);
                        }
                    }
                    _state.lastStrokeDir = dir;
                    _state.strokeTimer = 60; // frames until stroke resets
                }
            }
        });

        canvas.addEventListener('mouseup', (e) => {
            const pos = canvasCoords(canvas, e);
            if (_state.isDown && !_state.isDragging && isOverPet(pos.x, pos.y)) {
                if (navigator.vibrate) navigator.vibrate(10);
                spawnRipple(pos.x, pos.y);
                Events.emit('pet-poke', { x: pos.x, y: pos.y });
            } else if (_state.isDown && !_state.isDragging) {
                // Cottage first, then environment (fireflies, sun, moon)
                import('./shelter.js').then(({ Shelter }) => {
                    const region = Shelter.hitTest(pos.x, pos.y);
                    if (region) {
                        Shelter.onTap(region);
                        Events.emit('shelter-tap', { region, x: pos.x, y: pos.y });
                    } else {
                        import('./renderer.js').then(({ Renderer }) => {
                            const hit = Renderer.hitTestEnvironment(pos.x, pos.y);
                            if (hit) Events.emit('environment-tap', hit);
                        }).catch(() => {});
                    }
                }).catch(() => {});
            }
            if (_state.petStrokes >= 4) {
                if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
                Events.emit('pet-pet', { strokes: _state.petStrokes });
            }
            _state.isDown = false;
            _state.isDragging = false;
            _state.petStrokes = 0;
            _state.lastStrokeDir = 0;
            resetScrub();
        });

        canvas.addEventListener('mouseleave', () => {
            _state.isDown = false;
            _state.isDragging = false;
        });

        // Touch events
        canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            const pos = canvasCoords(canvas, e);
            _state.isDown = true;
            _state.isDragging = false;
            _state.dragStartX = pos.x;
            _state.dragStartY = pos.y;
            _state.dragDist = 0;
            _state.x = pos.x;
            _state.y = pos.y;
            _state.cursorActive = true;
            _state.cursorFadeTimer = 300;
            _state.touchStartTime = performance.now();
            // Long-press detection (600ms over pet → show needs)
            _state.longPressTimer = setTimeout(() => {
                if (_state.isDown && !_state.isDragging && isOverPet(pos.x, pos.y)) {
                    if (navigator.vibrate) navigator.vibrate([15, 40, 15]);
                    _state.longPressTriggered = true;
                    Events.emit('pet-longpress', { x: pos.x, y: pos.y });
                }
            }, 600);
            _state.longPressTriggered = false;
        }, { passive: false });

        canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            const pos = canvasCoords(canvas, e);
            const dx = pos.x - _state.x;
            const dy = pos.y - _state.y;
            const now = performance.now();
            const dt = now - _state.lastMoveTime;
            _state.moveSpeed = dt > 0 ? Math.hypot(dx, dy) / dt * 16 : 0;
            _state.x = pos.x;
            _state.y = pos.y;
            _state.lastMoveTime = now;

            if (_state.isDown) {
                const step = Math.abs(dx) + Math.abs(dy);
                _state.dragDist += step;
                if (_state.dragDist > 10) {
                    _state.isDragging = true;
                    if (_state.longPressTimer) { clearTimeout(_state.longPressTimer); _state.longPressTimer = null; }
                }

                if (_state.isDragging) updateScrub(pos);

                if (isOverPet(pos.x, pos.y) && _state.isDragging) {
                    // Accept strokes in any direction (dominant axis)
                    const useX = Math.abs(dx) >= Math.abs(dy);
                    const delta = useX ? dx : dy;
                    if (Math.abs(delta) > 2) {
                        const dir = delta > 0 ? 1 : -1;
                        if (dir !== _state.lastStrokeDir && _state.lastStrokeDir !== 0) {
                            _state.petStrokes++;
                            if (_state.petStrokes % 3 === 0) {
                                spawnHeart(pos.x, pos.y);
                                if (navigator.vibrate) navigator.vibrate(5);
                            }
                        }
                        _state.lastStrokeDir = dir;
                        _state.strokeTimer = 60;
                    }
                }
            }
        }, { passive: false });

        canvas.addEventListener('touchend', (e) => {
            if (_state.longPressTimer) { clearTimeout(_state.longPressTimer); _state.longPressTimer = null; }
            if (_state.isDown && !_state.isDragging && !_state.longPressTriggered) {
                const x = _state.x, y = _state.y;
                if (isOverPet(x, y)) {
                    if (navigator.vibrate) navigator.vibrate(10);
                    spawnRipple(x, y);
                    Events.emit('pet-poke', { x, y });
                } else {
                    import('./shelter.js').then(({ Shelter }) => {
                        const region = Shelter.hitTest(x, y);
                        if (region) {
                            Shelter.onTap(region);
                            Events.emit('shelter-tap', { region, x, y });
                        } else {
                            import('./renderer.js').then(({ Renderer }) => {
                                const hit = Renderer.hitTestEnvironment(x, y);
                                if (hit) Events.emit('environment-tap', hit);
                            }).catch(() => {});
                        }
                    }).catch(() => {});
                }
            }
            if (_state.petStrokes >= 4) {
                if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
                Events.emit('pet-pet', { strokes: _state.petStrokes });
            }
            _state.isDown = false;
            _state.isDragging = false;
            _state.petStrokes = 0;
            _state.lastStrokeDir = 0;
            _state.longPressTriggered = false;
            resetScrub();
        });
    },

    /** Update pet hit area each frame */
    setPetPosition(cx, cy, radius) {
        _state.petCx = cx;
        _state.petCy = cy;
        _state.petRadius = radius;
    },

    /** Get cursor position for eye tracking */
    getCursorPos() {
        if (_state.cursorFadeTimer > 0) {
            _state.cursorFadeTimer--;
            return { x: _state.x, y: _state.y, active: true };
        }
        return { x: _state.x, y: _state.y, active: false };
    },

    /** Whether user is currently petting */
    isPetting() {
        return _state.isDragging && _state.petStrokes >= 2 && isOverPet(_state.x, _state.y);
    },

    /** Update and render particles */
    update(ctx, tick) {
        // Stroke timer decay
        if (_state.strokeTimer > 0) {
            _state.strokeTimer--;
        } else {
            _state.petStrokes = 0;
            _state.lastStrokeDir = 0;
        }

        // Update & draw hearts
        for (let i = _state.hearts.length - 1; i >= 0; i--) {
            const h = _state.hearts[i];
            h.x += h.vx;
            h.y += h.vy;
            h.vy -= 0.02; // float up slower
            h.life -= 0.012;
            if (h.life <= 0) { _state.hearts.splice(i, 1); continue; }

            ctx.save();
            ctx.globalAlpha = h.life;
            ctx.fillStyle = '#E060A0';
            _drawHeart(ctx, h.x, h.y, h.size);
            ctx.restore();
        }

        // Update & draw bubbles (circular scrub feedback)
        for (let i = _state.bubbles.length - 1; i >= 0; i--) {
            const b = _state.bubbles[i];
            b.x += b.vx; b.y += b.vy;
            b.vy *= 0.98;
            b.life -= 0.018;
            if (b.life <= 0) { _state.bubbles.splice(i, 1); continue; }
            ctx.save();
            ctx.globalAlpha = b.life * 0.8;
            ctx.strokeStyle = '#8EE5FF';
            ctx.fillStyle = 'rgba(142,229,255,0.18)';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        // Update & draw ripples
        for (let i = _state.ripples.length - 1; i >= 0; i--) {
            const r = _state.ripples[i];
            r.radius += 1.5;
            r.life -= 0.025;
            if (r.life <= 0 || r.radius > r.maxRadius) { _state.ripples.splice(i, 1); continue; }

            ctx.save();
            ctx.globalAlpha = r.life * 0.5;
            ctx.strokeStyle = '#3ECFCF';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(r.x, r.y, r.radius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    },
};

function _drawHeart(ctx, x, y, size) {
    const s = size / 10;
    ctx.beginPath();
    ctx.moveTo(x, y + s * 3);
    ctx.bezierCurveTo(x, y, x - s * 5, y, x - s * 5, y + s * 3);
    ctx.bezierCurveTo(x - s * 5, y + s * 6, x, y + s * 9, x, y + s * 10);
    ctx.bezierCurveTo(x, y + s * 9, x + s * 5, y + s * 6, x + s * 5, y + s * 3);
    ctx.bezierCurveTo(x + s * 5, y, x, y, x, y + s * 3);
    ctx.fill();
}
