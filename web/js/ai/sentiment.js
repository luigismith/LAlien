/**
 * sentiment.js -- Lightweight local sentiment classifier (no LLM call).
 *
 * Italian-first keyword lists + English/Spanish overlap. Returns a score
 * in [-1, +1] plus confidence and a bucket ('positive' | 'neutral' | 'negative').
 *
 * It is intentionally cheap and imperfect — we only use it to nudge the
 * pet's mood (NASHI, AFFECTION) in the right direction, never to make
 * hard decisions.
 */

// Positive markers (lowercase, no accents stripped — matched as whole words)
const POSITIVE = new Set([
    // IT affection
    'amo', 'ti amo', 'voglio bene', 'bene', 'bravo', 'brava', 'bravissimo',
    'bello', 'bella', 'bellissimo', 'stupendo', 'meraviglioso', 'dolce',
    'caro', 'cara', 'tesoro', 'amore', 'adoro', 'grazie', 'felice',
    'contento', 'contenta', 'orgoglioso', 'orgogliosa', 'fantastico',
    'forte', 'super', 'ottimo', 'perfetto', 'gentile', 'simpatico',
    'coccole', 'abbraccio', 'bacio', 'sorriso', 'ridere', 'gioia',
    'speciale', 'unico', 'prezioso', 'incredibile', 'magnifico',
    // IT encouragement
    'tranquillo', 'tranquilla', 'ce la fai', 'puoi farcela', 'coraggio',
    'vicino', 'presente', 'proteggo', 'insieme',
    // EN overlap (short)
    'love', 'good', 'nice', 'great', 'wonderful', 'proud', 'sweet',
    'happy', 'thanks', 'amazing', 'hug', 'kiss',
    // ES tiny
    'te quiero', 'amor', 'bueno', 'feliz', 'gracias',
]);

const NEGATIVE = new Set([
    // IT hostility / rejection
    'odio', 'ti odio', 'brutto', 'brutta', 'stupido', 'stupida', 'scemo',
    'scema', 'idiota', 'deficiente', 'pessimo', 'orribile', 'schifo',
    'schifoso', 'disgustoso', 'cattivo', 'cattiva', 'noioso', 'noiosa',
    'fastidioso', 'inutile', 'vattene', 'sparisci', 'zitto', 'stai zitto',
    'tacere', 'basta', 'non voglio', 'lasciami', 'vai via', 'sparire',
    // IT sadness / fatigue
    'triste', 'piangere', 'male', 'paura', 'arrabbiato', 'arrabbiata',
    'rabbia', 'furia', 'furioso', 'deluso', 'delusa',
    'stanco di', 'non sopporto', 'detesto',
    // EN overlap
    'hate', 'bad', 'stupid', 'idiot', 'boring', 'shut up', 'go away',
    'ugly', 'annoying', 'useless', 'sad', 'angry',
    // ES tiny
    'odio', 'malo', 'feo', 'idiota', 'callate',
]);

// Multi-word tokens we want to catch whole (2-3 grams)
const MULTI_POS = [
    'ti amo', 'voglio bene', 'ti adoro', 'bravo bambino', 'brava bambina',
    'ce la fai', 'puoi farcela', 'sei speciale', 'te quiero', 'good boy',
    'good girl',
];
const MULTI_NEG = [
    'ti odio', 'stai zitto', 'vai via', 'non voglio', 'stanco di',
    'non ti sopporto', 'shut up', 'go away',
];

// Intensifiers & negators
const INTENSIFIERS = new Set([
    'molto', 'tanto', 'tantissimo', 'troppo', 'super', 'davvero', 'veramente',
    'estremamente', 'really', 'very', 'so', 'muy',
]);
const NEGATORS = new Set([
    'non', 'mai', 'niente', 'nulla', 'no', 'not', "don't", 'dont', 'never',
    'nunca', 'nada',
]);

function normalize(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[.,!?;:"'()\[\]{}…]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export const Sentiment = {
    /**
     * @param {string} text
     * @returns {{ score: number, bucket: 'positive'|'neutral'|'negative', confidence: number, hits: {pos:string[], neg:string[]} }}
     */
    analyze(text) {
        const norm = normalize(text);
        if (!norm) return { score: 0, bucket: 'neutral', confidence: 0, hits: { pos: [], neg: [] } };

        const hits = { pos: [], neg: [] };
        let score = 0;
        let absoluteMagnitude = 0;

        // Multi-word passes first
        for (const phrase of MULTI_POS) {
            if (norm.includes(phrase)) { hits.pos.push(phrase); score += 1.2; absoluteMagnitude += 1.2; }
        }
        for (const phrase of MULTI_NEG) {
            if (norm.includes(phrase)) { hits.neg.push(phrase); score -= 1.2; absoluteMagnitude += 1.2; }
        }

        // Token-level
        const tokens = norm.split(' ');
        for (let i = 0; i < tokens.length; i++) {
            const t = tokens[i];
            if (!t) continue;
            let weight = 1;
            // Check preceding intensifier/negator (up to 2 back)
            let negated = false;
            for (let k = 1; k <= 2 && i - k >= 0; k++) {
                const prev = tokens[i - k];
                if (INTENSIFIERS.has(prev)) weight *= 1.5;
                if (NEGATORS.has(prev)) { negated = !negated; }
            }
            if (POSITIVE.has(t)) {
                const s = (negated ? -1 : 1) * weight;
                score += s; absoluteMagnitude += Math.abs(s);
                (negated ? hits.neg : hits.pos).push(t);
            } else if (NEGATIVE.has(t)) {
                const s = (negated ? 1 : -1) * weight;
                score += s; absoluteMagnitude += Math.abs(s);
                (negated ? hits.pos : hits.neg).push(t);
            }
        }

        // Normalize to [-1, +1] with diminishing returns
        const normScore = Math.tanh(score / 2.5);
        const bucket = normScore > 0.2 ? 'positive'
                     : normScore < -0.2 ? 'negative'
                     : 'neutral';
        const confidence = Math.min(1, absoluteMagnitude / 3);

        return { score: normScore, bucket, confidence, hits };
    },
};
