/**
 * speech-bubble.js -- Typewriter text effect with mood variants
 */

let _timeout = null;
let _typeInterval = null;

export const SpeechBubble = {
    show(text, mood = 'neutral', duration = 3000) {
        const bubble = document.getElementById('speech-bubble');
        const textEl = document.getElementById('speech-text');

        // Clear previous
        clearTimeout(_timeout);
        clearInterval(_typeInterval);

        // Remove old mood classes
        bubble.className = '';
        bubble.classList.add(`mood-${mood}`);
        bubble.classList.remove('hidden');

        // Typewriter effect (30 chars/sec)
        textEl.textContent = '';
        let i = 0;
        const speed = 1000 / 30;
        _typeInterval = setInterval(() => {
            if (i < text.length) {
                textEl.textContent += text[i];
                i++;
            } else {
                clearInterval(_typeInterval);
            }
        }, speed);

        // Auto-dismiss (reading time: at least duration, plus 50ms per char)
        const readTime = Math.max(duration, text.length * 50 + 1500);
        _timeout = setTimeout(() => {
            bubble.classList.add('hidden');
        }, readTime);
    },

    hide() {
        clearTimeout(_timeout);
        clearInterval(_typeInterval);
        document.getElementById('speech-bubble').classList.add('hidden');
    },
};
