/**
 * llm-client.js -- Fetch-based LLM client
 * Supports Anthropic Claude and OpenAI GPT
 * API key encrypted in localStorage via AES-GCM
 */

let _provider = 'anthropic';
let _apiKey = '';
let _history = []; // last 5 turns
const MAX_HISTORY = 5;
const MAX_RETRIES = 3;
const RATE_LIMIT_MS = 2000;
let _lastCallTime = 0;

// ---- Encryption helpers ----
const PASSPHRASE = 'lalien-companion-local-key-v1'; // Not truly secret, just obscures plaintext in localStorage

async function deriveKey(passphrase) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: enc.encode('lalien-salt'), iterations: 100000, hash: 'SHA-256' },
        keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
}

async function encryptString(text) {
    const key = await deriveKey(PASSPHRASE);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const enc = new TextEncoder();
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
    const buf = new Uint8Array(iv.length + ct.byteLength);
    buf.set(iv, 0);
    buf.set(new Uint8Array(ct), iv.length);
    return btoa(String.fromCharCode(...buf));
}

async function decryptString(b64) {
    const key = await deriveKey(PASSPHRASE);
    const raw = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const iv = raw.slice(0, 12);
    const ct = raw.slice(12);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return new TextDecoder().decode(pt);
}

export const LLMClient = {
    init(provider, apiKey) {
        _provider = provider;
        _apiKey = apiKey;
        _history = [];
    },

    async saveApiKey(key) {
        const enc = await encryptString(key);
        localStorage.setItem('lalien_api_enc', enc);
    },

    async loadApiKey() {
        const enc = localStorage.getItem('lalien_api_enc');
        if (!enc) return null;
        try { return await decryptString(enc); }
        catch { return null; }
    },

    async saveKey(storageKey, key) {
        const enc = await encryptString(key);
        localStorage.setItem(storageKey, enc);
    },

    async loadKey(storageKey) {
        const enc = localStorage.getItem(storageKey);
        if (!enc) return null;
        try { return await decryptString(enc); }
        catch { return null; }
    },

    isAvailable() {
        return _apiKey && _apiKey.length > 0;
    },

    getProvider() { return _provider; },

    clearHistory() { _history = []; },

    getHistory() { return [..._history]; },

    async chat(systemPrompt, userMessage) {
        if (!_apiKey) throw new Error('No API key configured');

        // Rate limit
        const now = Date.now();
        const wait = RATE_LIMIT_MS - (now - _lastCallTime);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));

        // Add user message to history
        _history.push({ role: 'user', content: userMessage });
        if (_history.length > MAX_HISTORY * 2) {
            _history = _history.slice(-MAX_HISTORY * 2);
        }

        let lastError;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                _lastCallTime = Date.now();
                const response = _provider === 'anthropic'
                    ? await this._callAnthropic(systemPrompt)
                    : await this._callOpenAI(systemPrompt);

                // Add response to history
                _history.push({ role: 'assistant', content: response });
                if (_history.length > MAX_HISTORY * 2) {
                    _history = _history.slice(-MAX_HISTORY * 2);
                }
                return response;
            } catch (e) {
                lastError = e;
                if (attempt < MAX_RETRIES - 1) {
                    const delay = Math.pow(2, attempt) * 1000;
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
        throw lastError;
    },

    async _callAnthropic(systemPrompt) {
        const body = {
            model: 'claude-sonnet-4-20250514',
            max_tokens: 256,
            system: systemPrompt,
            messages: _history.map(m => ({ role: m.role, content: m.content })),
        };

        const res = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': _apiKey,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Anthropic API error ${res.status}: ${errText}`);
        }

        const data = await res.json();
        return data.content?.[0]?.text || '';
    },

    async _callOpenAI(systemPrompt) {
        const messages = [
            { role: 'system', content: systemPrompt },
            ..._history.map(m => ({ role: m.role, content: m.content })),
        ];

        const body = {
            model: 'gpt-4o-mini',
            max_tokens: 256,
            messages,
        };

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${_apiKey}`,
            },
            body: JSON.stringify(body),
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`OpenAI API error ${res.status}: ${errText}`);
        }

        const data = await res.json();
        return data.choices?.[0]?.message?.content || '';
    },

    async generateDiary(prompt) {
        return this.chat(prompt, 'Scrivi la tua pagina di diario per oggi.');
    },

    async generateLastWords(prompt) {
        return this.chat(prompt, 'Dì le tue ultime parole.');
    },
};
