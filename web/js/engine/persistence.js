/**
 * persistence.js -- IndexedDB wrapper for all game data
 * Stores: pet state, diary, vocabulary, memories, graveyard
 */

const DB_NAME = 'lalien_companion';
const DB_VERSION = 1;
const STORES = ['pet', 'diary', 'vocabulary', 'memories', 'graveyard'];

let db = null;

function openDB() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (e) => {
            const d = e.target.result;
            for (const name of STORES) {
                if (!d.objectStoreNames.contains(name)) {
                    d.createObjectStore(name, { keyPath: 'id', autoIncrement: name !== 'pet' });
                }
            }
        };
        req.onsuccess = () => { db = req.result; resolve(db); };
        req.onerror = () => reject(req.error);
    });
}

function tx(storeName, mode = 'readonly') {
    const t = db.transaction(storeName, mode);
    return t.objectStore(storeName);
}

function getOne(storeName, key) {
    return new Promise((resolve, reject) => {
        const req = tx(storeName).get(key);
        req.onsuccess = () => resolve(req.result?.data ?? null);
        req.onerror = () => reject(req.error);
    });
}

function putOne(storeName, key, data) {
    return new Promise((resolve, reject) => {
        const store = tx(storeName, 'readwrite');
        const req = store.put({ id: key, data, ts: Date.now() });
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

function getAll(storeName) {
    return new Promise((resolve, reject) => {
        const req = tx(storeName).getAll();
        req.onsuccess = () => resolve(req.result.map(r => r.data));
        req.onerror = () => reject(req.error);
    });
}

function putAll(storeName, key, dataArray) {
    return new Promise((resolve, reject) => {
        const store = tx(storeName, 'readwrite');
        store.put({ id: key, data: dataArray, ts: Date.now() });
        store.transaction.oncomplete = () => resolve();
        store.transaction.onerror = () => reject(store.transaction.error);
    });
}

function clearStore(storeName) {
    return new Promise((resolve, reject) => {
        const store = tx(storeName, 'readwrite');
        const req = store.clear();
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
    });
}

export const Persistence = {
    async init() {
        await openDB();
    },

    // --- Pet state ---
    async savePet(state) {
        await putOne('pet', 'current', state);
    },

    async loadPet() {
        return await getOne('pet', 'current');
    },

    // --- Diary ---
    async saveDiary(entries) {
        await putAll('diary', 'entries', entries);
    },

    async loadDiary() {
        return await getOne('diary', 'entries');
    },

    // --- Vocabulary ---
    async saveVocabulary(words) {
        await putAll('vocabulary', 'discovered', words);
    },

    async loadVocabulary() {
        return await getOne('vocabulary', 'discovered');
    },

    // --- Memories ---
    async saveMemories(memories) {
        await putAll('memories', 'log', memories);
    },

    async loadMemories() {
        return await getOne('memories', 'log');
    },

    // --- Graveyard ---
    async saveGraveyard(graves) {
        await putAll('graveyard', 'graves', graves);
    },

    async loadGraveyard() {
        return await getOne('graveyard', 'graves');
    },

    async addGrave(grave) {
        const graves = (await this.loadGraveyard()) || [];
        graves.push(grave);
        await this.saveGraveyard(graves);
    },

    // --- Export / Import ---
    async exportSave() {
        const data = {
            version: 1,
            timestamp: Date.now(),
            pet: await this.loadPet(),
            diary: await this.loadDiary(),
            vocabulary: await this.loadVocabulary(),
            memories: await this.loadMemories(),
            graveyard: await this.loadGraveyard(),
            settings: {
                language: localStorage.getItem('lalien_language'),
                provider: localStorage.getItem('lalien_provider'),
            }
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lalien_save_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    },

    async importSave(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if (data.version !== 1) throw new Error('Unsupported save version');
                    if (data.pet) await this.savePet(data.pet);
                    if (data.diary) await this.saveDiary(data.diary);
                    if (data.vocabulary) await this.saveVocabulary(data.vocabulary);
                    if (data.memories) await this.saveMemories(data.memories);
                    if (data.graveyard) await this.saveGraveyard(data.graveyard);
                    if (data.settings) {
                        if (data.settings.language) localStorage.setItem('lalien_language', data.settings.language);
                        if (data.settings.provider) localStorage.setItem('lalien_provider', data.settings.provider);
                    }
                    resolve();
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    },

    // --- Reset ---
    async resetAll() {
        for (const name of STORES) {
            await clearStore(name);
        }
        localStorage.removeItem('lalien_language');
        localStorage.removeItem('lalien_provider');
        localStorage.removeItem('lalien_api_enc');
        localStorage.removeItem('lalien_stt_key_enc');
    }
};
