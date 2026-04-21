/**
 * cloud-sync.js -- NAS cloud save sync
 * PIN login → token → auto-sync pet state to NAS server
 */

const TOKEN_KEY = 'lalien_cloud_token';
const USERNAME_KEY = 'lalien_cloud_user';
// Auto-detect base URL (same origin)
const API_BASE = '';  // relative URLs → same server

let _token = null;
let _username = 'Custode';
let _online = false;
let _pushTimer = null;

export const CloudSync = {

    // ---- Init & status -------------------------------------------------------

    async init() {
        _token = localStorage.getItem(TOKEN_KEY) || null;
        _username = localStorage.getItem(USERNAME_KEY) || 'Custode';
        if (_token) {
            _online = await this._checkOnline();
        }
        return { loggedIn: !!_token, online: _online, username: _username };
    },

    isLoggedIn() { return !!_token; },
    isOnline()   { return _online; },
    getUsername(){ return _username; },
    getToken()   { return _token; },

    // ---- Auth ----------------------------------------------------------------

    async login(pin, username) {
        const res = await fetch(API_BASE + '/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin: String(pin), username: username || 'Custode' }),
        });
        if (!res.ok) throw new Error('Login fallito: ' + res.status);
        const data = await res.json();
        _token = data.token;
        _username = data.username;
        _online = true;
        localStorage.setItem(TOKEN_KEY, _token);
        localStorage.setItem(USERNAME_KEY, _username);
        return data;  // {token, username, is_new}
    },

    logout() {
        _token = null;
        _online = false;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(USERNAME_KEY);
    },

    // ---- Cloud save / load ---------------------------------------------------

    /** Pull full save from server. Returns parsed JSON or null. */
    async pull() {
        if (!_token) return null;
        try {
            const res = await fetch(API_BASE + '/api/data', {
                headers: { 'X-Token': _token },
            });
            if (res.status === 404) return null;
            if (!res.ok) return null;
            _online = true;
            return await res.json();
        } catch {
            _online = false;
            return null;
        }
    },

    /** Push full save to server (debounced 3s). */
    push(saveData) {
        if (!_token) return;
        clearTimeout(_pushTimer);
        _pushTimer = setTimeout(() => this._doPush(saveData), 3000);
    },

    /** Immediate push (blocking). */
    async pushNow(saveData) {
        if (!_token) return false;
        return this._doPush(saveData);
    },

    async _doPush(saveData) {
        try {
            const res = await fetch(API_BASE + '/api/data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Token': _token },
                body: JSON.stringify(saveData),
            });
            _online = res.ok;
            return res.ok;
        } catch {
            _online = false;
            return false;
        }
    },

    // ---- Helpers -------------------------------------------------------------

    async _checkOnline() {
        try {
            const res = await fetch(API_BASE + '/api/status', { method: 'GET' });
            return res.ok;
        } catch {
            return false;
        }
    },
};
