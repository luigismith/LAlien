/**
 * weather.js -- OpenWeatherMap integration.
 *
 * Fetches the real-world weather at the keeper's geolocation and normalises it
 * to a simple palette the renderer understands: 'clear' | 'clouds' | 'rain' |
 * 'snow' | 'thunder' | 'mist'. Temperature and sunrise/sunset are piped into
 * the Environment module so the sky cycle is also real-time accurate.
 *
 * All network work is best-effort: offline, no key, or denied geolocation all
 * fall back to 'clear' with computed sun times.
 */
import { Environment } from './environment.js';
import { Events } from './events.js';

const LS_KEY      = 'lalien_owm_key';
const LS_LAST     = 'lalien_weather_last';
const REFRESH_MS  = 15 * 60 * 1000;   // 15 minutes
// Shared fallback key (free tier). Visible in the bundle — monitor usage; the
// keeper can override it from Settings with their own key.
const DEFAULT_KEY = 'd5a1ceb560c057d7f6b91805cfb96b9a';

let _state = {
    condition: 'clear',  // clear | clouds | rain | snow | thunder | mist
    intensity: 0,        // 0..1 for rain/snow density
    clouds: 0,           // 0..100 percent
    temp: 20,
    wind: 0,
    updatedAt: 0,
    source: 'default',
};
let _key = localStorage.getItem(LS_KEY) || DEFAULT_KEY;
let _tickHandle = null;

// Restore last snapshot from localStorage so the first render is not 'default'
try {
    const raw = localStorage.getItem(LS_LAST);
    if (raw) _state = { ..._state, ...JSON.parse(raw) };
} catch (_) {}

function owmToCondition(main, id) {
    main = (main || '').toLowerCase();
    if (id >= 200 && id < 300) return 'thunder';
    if (id >= 300 && id < 400) return 'rain';        // drizzle
    if (id >= 500 && id < 600) return 'rain';
    if (id >= 600 && id < 700) return 'snow';
    if (id >= 700 && id < 800) return 'mist';
    if (id === 800)            return 'clear';
    if (id > 800)              return 'clouds';
    if (main.includes('rain')) return 'rain';
    if (main.includes('snow')) return 'snow';
    if (main.includes('cloud')) return 'clouds';
    return 'clear';
}

function intensityForId(id) {
    // Heuristic based on OWM condition codes
    if (id === 200 || id === 201 || id === 202) return 0.95; // heavy thunder
    if (id >= 502 && id <= 504) return 0.9;   // heavy rain
    if (id === 500 || id === 501) return 0.55;
    if (id >= 300 && id < 322) return 0.35;   // drizzle
    if (id === 511) return 0.6;               // freezing rain
    if (id === 600) return 0.45;
    if (id === 601) return 0.7;
    if (id === 602) return 0.95;
    return 0.55;
}

async function getGeolocation() {
    if (Environment.getLocation()) return Environment.getLocation();
    if (!navigator.geolocation) return null;
    return new Promise((resolve) => {
        const timeout = setTimeout(() => resolve(null), 8000);
        navigator.geolocation.getCurrentPosition(
            pos => {
                clearTimeout(timeout);
                const loc = { lat: pos.coords.latitude, lon: pos.coords.longitude };
                Environment.setLocation(loc.lat, loc.lon);
                resolve(loc);
            },
            _err => { clearTimeout(timeout); resolve(null); },
            { timeout: 7000, maximumAge: 6 * 3600 * 1000 }
        );
    });
}

async function fetchOnce() {
    if (!_key) return;
    const loc = await getGeolocation();
    if (!loc) return;
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${loc.lat}&lon=${loc.lon}&appid=${_key}&units=metric`;
    try {
        const res = await fetch(url);
        if (!res.ok) {
            console.warn('[Weather] OWM', res.status, await res.text());
            return;
        }
        const j = await res.json();
        const w0 = (j.weather && j.weather[0]) || {};
        _state = {
            condition: owmToCondition(w0.main, w0.id || 800),
            intensity: intensityForId(w0.id || 800),
            clouds: (j.clouds && j.clouds.all) || 0,
            temp: (j.main && j.main.temp) ?? 20,
            wind: (j.wind && j.wind.speed) ?? 0,
            updatedAt: Date.now(),
            source: 'owm',
        };
        try { localStorage.setItem(LS_LAST, JSON.stringify(_state)); } catch (_) {}

        // Push authoritative sun times to Environment (ms)
        const sys = j.sys || {};
        if (sys.sunrise && sys.sunset) {
            Environment.setSunOverride(sys.sunrise * 1000, sys.sunset * 1000);
        }
        Events.emit && Events.emit('weather-update', _state);
    } catch (err) {
        console.warn('[Weather] fetch failed', err);
    }
}

export const Weather = {
    init() {
        if (_key) {
            fetchOnce();
            if (_tickHandle) clearInterval(_tickHandle);
            _tickHandle = setInterval(fetchOnce, REFRESH_MS);
        }
    },

    setApiKey(key) {
        const trimmed = (key || '').trim();
        if (trimmed) {
            _key = trimmed;
            try { localStorage.setItem(LS_KEY, _key); } catch (_) {}
            this.init();
        } else {
            // Clearing restores the shared default key
            try { localStorage.removeItem(LS_KEY); } catch (_) {}
            _key = DEFAULT_KEY;
        }
    },

    hasApiKey() { return !!_key; },
    isUsingDefaultKey() { return _key === DEFAULT_KEY; },

    /** Force a geolocation request and immediate refresh */
    async requestLocationAndRefresh() {
        if (!_key) return { ok: false, reason: 'no-key' };
        try {
            localStorage.removeItem(LS_KEY.replace('owm_key','geo_location'));
        } catch (_) {}
        await fetchOnce();
        return { ok: _state.source === 'owm', state: _state };
    },

    get() { return _state; },

    isRaining()  { return _state.condition === 'rain' || _state.condition === 'thunder'; },
    isSnowing()  { return _state.condition === 'snow'; },
    isCloudy()   { return _state.condition === 'clouds' || _state.clouds > 60; },
    isThunder()  { return _state.condition === 'thunder'; },
};
