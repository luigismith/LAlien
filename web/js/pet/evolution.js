/**
 * evolution.js -- Stage evolution triggers
 * Port of firmware/src/pet/evolution.cpp
 * 8 stages with exact same requirements
 */
import { Needs, NeedType } from './needs.js';

// Evolution requirements table (index = current stage -> next)
const REQUIREMENTS = [
    // Stage 0 (EGG->LARVA): 24h + touch>3
    { minAgeHours: 24, minAvgNeeds: 0, minTouch: 3, minVoice: 0, minVocab: 0, minConvs: 0, minDiary: 0, minBond: 0, minCosmic: 0, needsSustain: false },
    // Stage 1 (LARVA->PUPA): 72h + vocab>5 + avg>50%
    { minAgeHours: 72, minAvgNeeds: 50, minTouch: 0, minVoice: 0, minVocab: 5, minConvs: 0, minDiary: 0, minBond: 0, minCosmic: 0, needsSustain: false },
    // Stage 2 (PUPA->JUVENILE): 168h + vocab>15
    { minAgeHours: 168, minAvgNeeds: 50, minTouch: 0, minVoice: 0, minVocab: 15, minConvs: 0, minDiary: 0, minBond: 0, minCosmic: 0, needsSustain: false },
    // Stage 3 (JUVENILE->ADOLESCENT): 336h + vocab>30 + bond>60%
    { minAgeHours: 336, minAvgNeeds: 50, minTouch: 0, minVoice: 0, minVocab: 30, minConvs: 0, minDiary: 0, minBond: 60, minCosmic: 0, needsSustain: false },
    // Stage 4 (ADOLESCENT->ADULT): 672h + vocab>60 + convs>50
    { minAgeHours: 672, minAvgNeeds: 50, minTouch: 0, minVoice: 0, minVocab: 60, minConvs: 50, minDiary: 0, minBond: 0, minCosmic: 0, needsSustain: false },
    // Stage 5 (ADULT->ELDER): 1344h + vocab>100
    { minAgeHours: 1344, minAvgNeeds: 55, minTouch: 0, minVoice: 0, minVocab: 100, minConvs: 0, minDiary: 0, minBond: 0, minCosmic: 0, needsSustain: false },
    // Stage 6 (ELDER->TRANSCENDENT): 2160h + vocab>100 + bond>90 + all>80 sustained
    { minAgeHours: 2160, minAvgNeeds: 80, minTouch: 0, minVoice: 0, minVocab: 100, minConvs: 0, minDiary: 0, minBond: 90, minCosmic: 60, needsSustain: true },
];

export const Evolution = {
    _isEvolving: false,
    _fromStage: 0,
    _toStage: 0,

    canEvolve(currentStage, ageHours, needs, touchInteractions, voiceInteractions, vocabSize, conversations, diaryEntries) {
        if (currentStage >= REQUIREMENTS.length) return false;

        const req = REQUIREMENTS[currentStage];

        if (ageHours < req.minAgeHours) return false;

        const avg = Needs.getOverallWellness(needs);
        if (req.minAvgNeeds > 0 && avg < req.minAvgNeeds) return false;

        if (req.minTouch > 0 && touchInteractions < req.minTouch) return false;
        if (req.minVoice > 0 && voiceInteractions < req.minVoice) return false;
        if (req.minVocab > 0 && vocabSize < req.minVocab) return false;
        if (req.minConvs > 0 && conversations < req.minConvs) return false;
        if (req.minDiary > 0 && diaryEntries < req.minDiary) return false;
        if (req.minBond > 0 && needs[NeedType.AFFECTION] < req.minBond) return false;
        if (req.minCosmic > 0 && needs[NeedType.COSMIC] < req.minCosmic) return false;

        if (req.needsSustain) {
            for (let i = 0; i < NeedType.COUNT; i++) {
                if (needs[i] < req.minAvgNeeds) return false;
            }
        }

        return true;
    },

    getRequirements(stage) {
        if (stage < REQUIREMENTS.length) return REQUIREMENTS[stage];
        return { minAgeHours: 99999, minAvgNeeds: 100, minTouch: 9999, minVoice: 9999, minVocab: 9999, minConvs: 9999, minDiary: 255, minBond: 100, minCosmic: 100, needsSustain: true };
    },

    getVisualRegression(needs) {
        const avg = Needs.getOverallWellness(needs);
        if (avg > 60) return 0;
        if (avg < 20) return 1;
        return (60 - avg) / 40;
    },

    isEvolving() { return this._isEvolving; },
    setEvolving(v) { this._isEvolving = v; },
    getFromStage() { return this._fromStage; },
    setFromStage(s) { this._fromStage = s; },
    getToStage() { return this._toStage; },
    setToStage(s) { this._toStage = s; },

    clearState() {
        this._isEvolving = false;
        this._fromStage = 0;
        this._toStage = 0;
    }
};
