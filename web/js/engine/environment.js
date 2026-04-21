/**
 * environment.js -- Real-world location, sun times, day-light curve.
 *
 * Pulls sunrise/sunset from Weather module when available; otherwise computes
 * them with a NOAA-style solar-elevation algorithm so the sky cycle stays
 * realistic even without an OpenWeatherMap key. Exposes:
 *   Environment.setLocation(lat, lon)
 *   Environment.getLocation()           -> { lat, lon } | null
 *   Environment.getSunTimes(date)       -> { sunrise, sunset } Date
 *   Environment.getDayLight(date)       -> 0..1
 *   Environment.getPhase(date)          -> 'night'|'dawn'|'day'|'dusk'
 *   Environment.getStarVisibility(date) -> 0..1
 */

const LS_KEY_LOC = 'lalien_geo_location';
let _loc = null;
let _sunOverride = null;  // from Weather module

function load() {
    try {
        const raw = localStorage.getItem(LS_KEY_LOC);
        if (raw) _loc = JSON.parse(raw);
    } catch (_) {}
}
load();

// ---------------------------------------------------------------------------
// NOAA solar algorithm (approximate, good to ~1 minute)
// Returns sunrise/sunset times for given date and location.
// ---------------------------------------------------------------------------
function computeSunTimes(date, lat, lon) {
    const rad = Math.PI / 180;
    const dayMs = 86400000;
    const J1970 = 2440588;
    const J2000 = 2451545;

    function toJulian(d) { return d.valueOf() / dayMs - 0.5 + J1970; }
    function fromJulian(j) { return new Date((j + 0.5 - J1970) * dayMs); }
    function toDays(d) { return toJulian(d) - J2000; }

    const d = toDays(date);
    const M = rad * (357.5291 + 0.98560028 * d);
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const P = rad * 102.9372;
    const L = M + C + P + Math.PI;
    const dec = Math.asin(Math.sin(0) * Math.cos(rad * 23.4397) + Math.cos(0) * Math.sin(rad * 23.4397) * Math.sin(L));
    const ra  = Math.atan2(Math.sin(L) * Math.cos(rad * 23.4397) - Math.tan(0) * Math.sin(rad * 23.4397), Math.cos(L));
    const n = Math.round(d - 0.0009 - (-lon * rad) / (2 * Math.PI));
    const ds = 0.0009 + (-lon * rad) / (2 * Math.PI) + n;
    const Ms = rad * (357.5291 + 0.98560028 * ds);
    const Ls = Ms + rad * (1.9148 * Math.sin(Ms) + 0.02 * Math.sin(2 * Ms) + 0.0003 * Math.sin(3 * Ms)) + P + Math.PI;
    const decs = Math.asin(Math.sin(0) * Math.cos(rad * 23.4397) + Math.cos(0) * Math.sin(rad * 23.4397) * Math.sin(Ls));
    const Jtransit = J2000 + ds + 0.0053 * Math.sin(Ms) - 0.0069 * Math.sin(2 * Ls);
    const latR = lat * rad;
    const h0 = -0.833 * rad;
    const cosW = (Math.sin(h0) - Math.sin(latR) * Math.sin(decs)) / (Math.cos(latR) * Math.cos(decs));
    if (cosW > 1)  return { sunrise: null, sunset: null, polar: 'night' };
    if (cosW < -1) return { sunrise: null, sunset: null, polar: 'day'   };
    const w = Math.acos(cosW);
    const Jset = J2000 + (w / (2 * Math.PI)) + ds + 0.0053 * Math.sin(Ms) - 0.0069 * Math.sin(2 * Ls);
    const Jrise = Jtransit - (Jset - Jtransit);
    return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset), polar: null };
}

function defaultSunTimes(date) {
    // Fallback: 06:00 / 20:00 local
    const r = new Date(date); r.setHours(6, 0, 0, 0);
    const s = new Date(date); s.setHours(20, 0, 0, 0);
    return { sunrise: r, sunset: s, polar: null };
}

export const Environment = {
    setLocation(lat, lon) {
        _loc = { lat, lon, at: Date.now() };
        try { localStorage.setItem(LS_KEY_LOC, JSON.stringify(_loc)); } catch (_) {}
    },

    getLocation() { return _loc; },

    /** Called by Weather module when OWM returns authoritative sunrise/sunset */
    setSunOverride(sunriseMs, sunsetMs) {
        if (!sunriseMs || !sunsetMs) { _sunOverride = null; return; }
        _sunOverride = { sunrise: new Date(sunriseMs), sunset: new Date(sunsetMs), at: Date.now() };
    },

    getSunTimes(date = new Date()) {
        // Prefer weather-provided if fresh (< 20h)
        if (_sunOverride && Date.now() - _sunOverride.at < 20 * 3600 * 1000) {
            return { sunrise: _sunOverride.sunrise, sunset: _sunOverride.sunset, polar: null };
        }
        if (_loc) return computeSunTimes(date, _loc.lat, _loc.lon);
        return defaultSunTimes(date);
    },

    /**
     * Day-light intensity 0..1 with smooth dawn/dusk ramps.
     * Peak daylight ≈ solar noon. Full dark ≈ midway between sunset and sunrise.
     */
    getDayLight(date = new Date()) {
        const { sunrise, sunset, polar } = this.getSunTimes(date);
        if (polar === 'day')   return 1;
        if (polar === 'night') return 0;
        const t = date.getTime();
        const sr = sunrise.getTime();
        const ss = sunset.getTime();
        const twilight = 45 * 60 * 1000;  // 45 min civil twilight ramp
        if (t < sr - twilight) return 0;
        if (t < sr + twilight) {
            // dawn ramp 0→1 across 1.5h centered on sunrise
            const p = (t - (sr - twilight)) / (twilight * 2);
            return Math.max(0, Math.min(1, p));
        }
        if (t < ss - twilight) {
            // midday curve — bell shape centered on solar noon
            const noon = (sr + ss) / 2;
            const half = (ss - sr) / 2;
            const d = Math.abs(t - noon) / half;  // 0 at noon, 1 at sunrise/sunset
            return Math.max(0.55, 1 - d * 0.35);  // 0.65 near horizon, 1 at noon
        }
        if (t < ss + twilight) {
            const p = 1 - (t - (ss - twilight)) / (twilight * 2);
            return Math.max(0, Math.min(1, p));
        }
        return 0;
    },

    getPhase(date = new Date()) {
        const { sunrise, sunset } = this.getSunTimes(date);
        if (!sunrise || !sunset) return 'day';
        const t = date.getTime();
        const tw = 45 * 60 * 1000;
        if (t < sunrise.getTime() - tw) return 'night';
        if (t < sunrise.getTime() + tw) return 'dawn';
        if (t < sunset.getTime()  - tw) return 'day';
        if (t < sunset.getTime()  + tw) return 'dusk';
        return 'night';
    },

    getStarVisibility(date = new Date()) {
        const dl = this.getDayLight(date);
        return Math.max(0, Math.min(1, 1 - dl * 1.4));  // fade stars out by day
    },
};
