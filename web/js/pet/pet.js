/**
 * pet.js -- Main pet state machine
 * Port of firmware/src/pet/pet.cpp
 */
import { Needs, NeedType, createNeedsState } from './needs.js';
import { Evolution } from './evolution.js';
import { Death, DeathType } from './death.js';
import { Events } from '../engine/events.js';
import { Activity } from './activity.js';

const STAGE_NAMES = [
    'Syrma', 'Lali-na', 'Lali-shi', 'Lali-ko',
    'Lali-ren', 'Lali-vox', 'Lali-mere', 'Lali-thishi'
];

const TRAIT_CURIOUS = 0x01;
const TRAIT_AFFECTIONATE = 0x02;
const TRAIT_RESERVED = 0x04;
const TRAIT_PLAYFUL = 0x08;
const TRAIT_CONTEMPLATIVE = 0x10;

const FOOD_NAMES = [
    'luce stellare', 'polvere cosmica', 'rugiada lunare',
    'cristalli di nebulosa', 'eco di supernova', 'filamenti solari',
    'particelle quantiche', 'essenza di buco nero'
];

const TIME_NAMES = ['mattina (alba)', 'pomeriggio (sole alto)', 'sera (tramonto)', 'notte (stelle)'];

export const Pet = {
    // State
    stage: 0,
    deathType: DeathType.NONE,
    alive: true,
    transcended: false,
    name: '',
    ageSeconds: 0,
    birthTimestamp: 0,
    lastRealTimestamp: 0,
    needs: createNeedsState(),

    // DNA
    dna: {
        hash: new Uint8Array(32),
        variantIndex: 0,
        appendageCount: 0,
        appendageLength: 0,
        eyeSize: 0,
        corePattern: 0,
        bodyCurvature: 0,
        paletteWarmth: 128,
        personalityTraits: 0,
        coreHue: 180,
    },

    // Counters
    voiceInteractions: 0,
    touchInteractions: 0,
    playInteractions: 0,
    conversations: 0,
    vocabularySize: 0,
    diaryEntries: 0,

    // Death trackers (delegated to Death module)
    morakStart: 0,
    velinStart: 0,
    renaStart: 0,
    buried: false,
    lastWords: '',

    // Action history for routine detection
    _actionHistory: [],

    // --- Public API ---

    initNew(name) {
        this.stage = 0; // SYRMA (egg)
        this.deathType = DeathType.NONE;
        this.alive = true;
        this.transcended = false;
        this.name = name || '';
        this.ageSeconds = 0;
        this.birthTimestamp = Date.now();
        this.lastRealTimestamp = Date.now();
        this.needs = createNeedsState();
        this.activity = null;   // initialized by Activity.init
        Activity.init(this);
        this.voiceInteractions = 0;
        this.touchInteractions = 0;
        this.playInteractions = 0;
        this.conversations = 0;
        this.vocabularySize = 0;
        this.diaryEntries = 0;
        this.morakStart = 0;
        this.velinStart = 0;
        this.renaStart = 0;
        this.buried = false;
        this.lastWords = '';
        this._actionHistory = [];

        // Clear DNA (generated at hatching)
        this.dna.hash = new Uint8Array(32);
        this.dna.personalityTraits = 0;

        Death.init();
        Needs.resetTracking();
    },

    update(timeMultiplier) {
        if (!this.alive) {
            if (Death.isSequencePlaying()) {
                Death.updateSequence();
            }
            if (Death.isSequenceComplete() && !this.buried) {
                this._buryPet();
            }
            return;
        }

        // Egg: track age, check evolution (hatching), but no need decay
        if (this.stage === 0) {
            this.ageSeconds += Math.floor(timeMultiplier);
            this._checkEvolution();
            this.lastRealTimestamp = Date.now();
            return;
        }

        this.ageSeconds += Math.floor(timeMultiplier);

        // Activity system (sleeping, eating...) runs first — may modify needs
        // and returns a decay multiplier (e.g. sleep slows decay to 0.35×).
        Activity.tick(this);
        const actMult = Activity.getDecayMultiplier(this);
        Needs.decay(this.needs, timeMultiplier * actMult, this.stage);

        // Pathological tracking
        if (Needs.isMorak(this.needs)) {
            if (this.morakStart === 0) this.morakStart = this.ageSeconds;
        } else { this.morakStart = 0; }

        if (Needs.isRenaThishi(this.needs)) {
            if (this.renaStart === 0) this.renaStart = this.ageSeconds;
        } else { this.renaStart = 0; }

        // Check evolution
        this._checkEvolution();

        // Check death
        this._checkDeath();

        this.lastRealTimestamp = Date.now();
    },

    recordAction(id) {
        this._actionHistory.push(id);
        if (this._actionHistory.length > 10) this._actionHistory.shift();
    },

    addTouchInteraction() {
        this.touchInteractions++;
        Death.recordInteraction(this.ageSeconds);
    },

    addConversation() {
        this.conversations++;
        this.voiceInteractions++;
        Death.recordInteraction(this.ageSeconds);
    },

    triggerFarewell() {
        if (!this.alive) return;
        this.deathType = DeathType.FAREWELL;
        this.alive = false;
        Death.startSequence(DeathType.FAREWELL);
    },

    applyGameResult(result) {
        if (!this.alive) return;

        Needs.applyGameNeeds(this.needs, result);

        for (let i = 0; i < result.interactionCount; i++) {
            this.touchInteractions++;
        }
        Death.recordInteraction(this.ageSeconds);
    },

    // --- Accessors ---

    getStage() { return this.stage; },
    getStageName() { return STAGE_NAMES[this.stage] || '???'; },
    getStageNameFor(s) { return STAGE_NAMES[s] || '???'; },
    isAlive() { return this.alive; },
    isEgg() { return this.stage === 0; },
    isTranscended() { return this.transcended; },
    getAgeHours() { return Math.floor(this.ageSeconds / 3600); },
    getAgeDays() { return Math.floor(this.ageSeconds / 86400); },
    getName() { return this.name; },
    getTotalInteractions() { return this.voiceInteractions + this.touchInteractions + this.playInteractions; },

    getMood() {
        const avg = Needs.getOverallWellness(this.needs);
        const security = this.needs[NeedType.SECURITY];
        if (security < 20) return 'scared';
        if (avg > 70) return 'happy';
        if (avg < 40) return 'sad';
        return 'neutral';
    },

    // --- DNA ---

    async generateDNA() {
        const data = new Uint8Array(64);
        crypto.getRandomValues(data);
        // Mix in timestamp
        const ts = Date.now();
        const tsBytes = new Uint8Array(8);
        for (let i = 0; i < 8; i++) tsBytes[i] = (ts >> (i * 8)) & 0xFF;
        for (let i = 0; i < 8; i++) data[i] ^= tsBytes[i];

        const hashBuf = await crypto.subtle.digest('SHA-256', data);
        this.dna.hash = new Uint8Array(hashBuf);
        this._deriveParams();
    },

    _deriveParams() {
        const h = this.dna.hash;
        this.dna.variantIndex = h[0] % 4;
        this.dna.appendageCount = h[1] % 7;
        this.dna.appendageLength = h[2] % 4;
        this.dna.eyeSize = h[3] % 4;
        this.dna.corePattern = h[4] % 8;
        this.dna.bodyCurvature = h[5] % 4;
        this.dna.paletteWarmth = h[6];
        this.dna.personalityTraits = h[7] & 0x1F;
        this.dna.coreHue = ((h[8] << 8) | h[9]) % 360;
    },

    hasTrait(trait) {
        return (this.dna.personalityTraits & trait) !== 0;
    },

    getPersonalityDescription() {
        const traits = [];
        if (this.hasTrait(TRAIT_CURIOUS)) traits.push('curioso e indagatore');
        if (this.hasTrait(TRAIT_AFFECTIONATE)) traits.push('affettuoso e premuroso');
        if (this.hasTrait(TRAIT_RESERVED)) traits.push('riservato e riflessivo');
        if (this.hasTrait(TRAIT_PLAYFUL)) traits.push('giocoso e vivace');
        if (this.hasTrait(TRAIT_CONTEMPLATIVE)) traits.push('contemplativo e profondo');
        if (traits.length === 0) traits.push('equilibrato e neutrale');
        return traits.join(', ');
    },

    getFoodPreferences() {
        const h = this.dna.hash;
        const prefs = new Set();
        for (let i = 0; i < 3; i++) {
            prefs.add(h[10 + i] % 8);
        }
        return [...prefs].map(i => FOOD_NAMES[i]);
    },

    getPreferredTimeOfDay() {
        return TIME_NAMES[this.dna.hash[13] % 4];
    },

    // --- Internal ---

    _checkEvolution() {
        if (Evolution.isEvolving()) return;

        if (Evolution.canEvolve(this.stage, this.getAgeHours(), this.needs,
            this.touchInteractions, this.voiceInteractions,
            this.vocabularySize, this.conversations, this.diaryEntries)) {

            const nextStage = this.stage + 1;
            if (nextStage <= 7) {
                const oldStage = this.stage;
                Evolution.setFromStage(oldStage);
                Evolution.setToStage(nextStage);
                Evolution.setEvolving(true);

                this.stage = nextStage;

                // Generate DNA at hatching
                if (oldStage === 0) {
                    this.generateDNA();
                }

                Events.emit('evolution', { from: oldStage, to: nextStage });
                Events.emit('pet-changed');
            }
        }
    },

    _checkDeath() {
        const dt = Death.checkDeathTriggers(
            this.stage, this.getAgeHours(), this.needs,
            this.ageSeconds, this.getTotalInteractions()
        );

        if (dt !== DeathType.NONE) {
            this.deathType = dt;
            this.alive = false;
            if (dt === DeathType.TRANSCENDENCE) this.transcended = true;
            Death.startSequence(dt);
            Events.emit('death', { type: dt, cause: Death.getCauseString(dt) });
            Events.emit('pet-changed');
        }
    },

    async _buryPet() {
        this.buried = true;
        const { Persistence } = await import('../engine/persistence.js');
        await Persistence.addGrave({
            name: this.name || 'Lalien',
            stage: this.stage,
            stageName: this.getStageName(),
            ageDays: this.getAgeDays(),
            cause: Death.getCauseString(this.deathType),
            lastWords: this.lastWords || '...',
            transcended: this.transcended,
            vocabSize: this.vocabularySize,
            timestamp: Date.now(),
        });
    },

    // --- Serialization ---

    serialize() {
        return {
            stage: this.stage,
            deathType: this.deathType,
            alive: this.alive,
            transcended: this.transcended,
            name: this.name,
            ageSeconds: this.ageSeconds,
            birthTimestamp: this.birthTimestamp,
            lastRealTimestamp: this.lastRealTimestamp,
            needs: Array.from(this.needs),
            dna: {
                hash: Array.from(this.dna.hash),
                variantIndex: this.dna.variantIndex,
                appendageCount: this.dna.appendageCount,
                appendageLength: this.dna.appendageLength,
                eyeSize: this.dna.eyeSize,
                corePattern: this.dna.corePattern,
                bodyCurvature: this.dna.bodyCurvature,
                paletteWarmth: this.dna.paletteWarmth,
                personalityTraits: this.dna.personalityTraits,
                coreHue: this.dna.coreHue,
            },
            voiceInteractions: this.voiceInteractions,
            touchInteractions: this.touchInteractions,
            playInteractions: this.playInteractions,
            conversations: this.conversations,
            vocabularySize: this.vocabularySize,
            diaryEntries: this.diaryEntries,
            morakStart: this.morakStart,
            velinStart: this.velinStart,
            renaStart: this.renaStart,
            buried: this.buried,
            lastWords: this.lastWords,
            deathTrackers: Death.serializeTrackers(),
            needsGameTime: Needs.getGameTimeSeconds(),
            activity: this.activity || null,
        };
    },

    deserialize(data) {
        if (!data) return;
        this.stage = data.stage ?? 0;
        this.deathType = data.deathType ?? DeathType.NONE;
        this.alive = data.alive ?? true;
        this.transcended = data.transcended ?? false;
        this.name = data.name ?? '';
        this.ageSeconds = data.ageSeconds ?? 0;
        this.birthTimestamp = data.birthTimestamp ?? Date.now();
        this.lastRealTimestamp = data.lastRealTimestamp ?? Date.now();

        if (data.needs) {
            for (let i = 0; i < NeedType.COUNT; i++) {
                this.needs[i] = data.needs[i] ?? 100;
            }
        }

        if (data.dna) {
            this.dna.hash = new Uint8Array(data.dna.hash || 32);
            this.dna.variantIndex = data.dna.variantIndex ?? 0;
            this.dna.appendageCount = data.dna.appendageCount ?? 0;
            this.dna.appendageLength = data.dna.appendageLength ?? 0;
            this.dna.eyeSize = data.dna.eyeSize ?? 0;
            this.dna.corePattern = data.dna.corePattern ?? 0;
            this.dna.bodyCurvature = data.dna.bodyCurvature ?? 0;
            this.dna.paletteWarmth = data.dna.paletteWarmth ?? 128;
            this.dna.personalityTraits = data.dna.personalityTraits ?? 0;
            this.dna.coreHue = data.dna.coreHue ?? 180;
        }

        this.voiceInteractions = data.voiceInteractions ?? 0;
        this.touchInteractions = data.touchInteractions ?? 0;
        this.playInteractions = data.playInteractions ?? 0;
        this.conversations = data.conversations ?? 0;
        this.vocabularySize = data.vocabularySize ?? 0;
        this.diaryEntries = data.diaryEntries ?? 0;
        this.morakStart = data.morakStart ?? 0;
        this.velinStart = data.velinStart ?? 0;
        this.renaStart = data.renaStart ?? 0;
        this.buried = data.buried ?? false;
        this.lastWords = data.lastWords ?? '';

        Death.init();
        Death.restoreTrackers(data.deathTrackers);
        Needs.setGameTimeSeconds(data.needsGameTime ?? 0);

        // Activity state (survives refresh)
        this.activity = data.activity || null;
        Activity.init(this);
        Activity.resume(this);
    },
};
