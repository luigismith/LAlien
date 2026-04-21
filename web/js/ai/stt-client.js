/**
 * stt-client.js -- Speech-to-text via Web Audio API + Whisper
 * Push-to-talk with 15s max recording, visual waveform feedback
 */
import { LLMClient } from './llm-client.js';

let _mediaRecorder = null;
let _audioChunks = [];
let _stream = null;
let _analyser = null;
let _audioCtx = null;
let _isRecording = false;
let _isAvailable = false;
let _maxDurationTimer = null;
let _onResult = null;
let _onError = null;
let _waveformCanvas = null;
let _waveformCtx = null;
let _animFrame = null;

const MAX_DURATION_MS = 15000;

export const STTClient = {
    init() {
        _isAvailable = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    },

    isAvailable() { return _isAvailable; },
    isRecording() { return _isRecording; },

    setWaveformCanvas(canvas) {
        _waveformCanvas = canvas;
        if (canvas) _waveformCtx = canvas.getContext('2d');
    },

    async startRecording(onResult, onError) {
        if (_isRecording) return;
        _onResult = onResult;
        _onError = onError;

        try {
            _stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = _audioCtx.createMediaStreamSource(_stream);
            _analyser = _audioCtx.createAnalyser();
            _analyser.fftSize = 256;
            source.connect(_analyser);

            _audioChunks = [];
            _mediaRecorder = new MediaRecorder(_stream, { mimeType: 'audio/webm' });

            _mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) _audioChunks.push(e.data);
            };

            _mediaRecorder.onstop = () => {
                this._processAudio();
            };

            _mediaRecorder.start();
            _isRecording = true;

            // Max duration
            _maxDurationTimer = setTimeout(() => this.stopRecording(), MAX_DURATION_MS);

            // Waveform visualization
            this._drawWaveform();

        } catch (e) {
            _isRecording = false;
            if (_onError) _onError(e.message);
        }
    },

    stopRecording() {
        if (!_isRecording) return;
        _isRecording = false;
        clearTimeout(_maxDurationTimer);
        cancelAnimationFrame(_animFrame);

        if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
            _mediaRecorder.stop();
        }
        if (_stream) {
            _stream.getTracks().forEach(t => t.stop());
            _stream = null;
        }
    },

    async _processAudio() {
        if (_audioChunks.length === 0) return;

        const blob = new Blob(_audioChunks, { type: 'audio/webm' });
        const sttKey = await LLMClient.loadKey('lalien_stt_key_enc');
        if (!sttKey) {
            if (_onError) _onError('No STT API key');
            return;
        }

        try {
            const formData = new FormData();
            formData.append('file', blob, 'recording.webm');
            formData.append('model', 'whisper-1');
            formData.append('language', localStorage.getItem('lalien_language') || 'it');

            const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${sttKey}` },
                body: formData,
            });

            if (!res.ok) throw new Error(`Whisper API error: ${res.status}`);

            const data = await res.json();
            if (_onResult) _onResult(data.text || '');
        } catch (e) {
            if (_onError) _onError(e.message);
        }

        if (_audioCtx) {
            _audioCtx.close();
            _audioCtx = null;
        }
    },

    _drawWaveform() {
        if (!_isRecording || !_analyser || !_waveformCtx) return;

        _animFrame = requestAnimationFrame(() => this._drawWaveform());

        const bufLen = _analyser.frequencyBinCount;
        const data = new Uint8Array(bufLen);
        _analyser.getByteTimeDomainData(data);

        const w = _waveformCanvas.width;
        const h = _waveformCanvas.height;
        _waveformCtx.clearRect(0, 0, w, h);
        _waveformCtx.lineWidth = 2;
        _waveformCtx.strokeStyle = '#3ECFCF';
        _waveformCtx.beginPath();

        const sliceW = w / bufLen;
        let x = 0;
        for (let i = 0; i < bufLen; i++) {
            const v = data[i] / 128.0;
            const y = (v * h) / 2;
            if (i === 0) _waveformCtx.moveTo(x, y);
            else _waveformCtx.lineTo(x, y);
            x += sliceW;
        }
        _waveformCtx.lineTo(w, h / 2);
        _waveformCtx.stroke();
    },
};
