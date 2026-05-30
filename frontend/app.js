// ==========================================
// Web Audio API による効果音合成モジュール (強化版)
// ==========================================
class AudioSynth {
    constructor() {
        this.ctx = null;
        this.masterVolume = null;
        // アンビエント管理
        this._ambientNode = null;
        this._ambientGain = null;
        this._pitchBgmNodes = [];
        this.timingGuideEnabled = true;
    }

    init(volumeVal) {
        if (this.ctx) return;
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContextClass();
        this.masterVolume = this.ctx.createGain();
        this.masterVolume.gain.value = volumeVal / 100;
        this.masterVolume.connect(this.ctx.destination);
        // ゲーム開始と同時に観客のざわめきを開始
        this.startAmbientCrowd();
    }

    setVolume(val) {
        if (this.masterVolume) {
            this.masterVolume.gain.value = val / 100;
        }
    }

    // --------------------------------------------------
    // 【NEW】観客アンビエント (常時流れる低レベルのざわめき)
    // --------------------------------------------------
    startAmbientCrowd() {
        if (!this.ctx || this._ambientNode) return;
        const bufSize = this.ctx.sampleRate * 4;
        const buf = this.ctx.createBuffer(2, bufSize, this.ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < bufSize; i++) d[i] = (Math.random() * 2 - 1);
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;

        const lpf = this.ctx.createBiquadFilter();
        lpf.type = 'lowpass';
        lpf.frequency.value = 800;

        // ゆっくりとした音量の揺れ (LFO)
        const lfo = this.ctx.createOscillator();
        const lfoGain = this.ctx.createGain();
        lfo.type = 'sine';
        lfo.frequency.value = 0.07; // 約14秒周期
        lfoGain.gain.value = 0.012;
        lfo.connect(lfoGain);

        const gain = this.ctx.createGain();
        gain.gain.value = 0.025;
        lfoGain.connect(gain.gain);

        src.connect(lpf);
        lpf.connect(gain);
        gain.connect(this.masterVolume);

        lfo.start();
        src.start();

        this._ambientNode = src;
        this._ambientGain = gain;
    }

    // ピンチ時にアンビエントをわずかに盛り上げる
    boostAmbient(boost = 0.06, durationSec = 3.0) {
        if (!this._ambientGain || !this.ctx) return;
        const now = this.ctx.currentTime;
        this._ambientGain.gain.setValueAtTime(this._ambientGain.gain.value, now);
        this._ambientGain.gain.linearRampToValueAtTime(boost, now + 0.5);
        this._ambientGain.gain.linearRampToValueAtTime(0.025, now + durationSec);
    }

    // --------------------------------------------------
    // 【NEW】ピッチング緊張BGM (2アウトなど緊張場面)
    // --------------------------------------------------
    startTensionBgm() {
        if (!this.ctx) return;
        this.stopTensionBgm();
        const now = this.ctx.currentTime;
        // 低音のパルス (心拍数のようなリズム)
        const bpm = 96;
        const interval = 60 / bpm;
        const nodes = [];
        for (let i = 0; i < 16; i++) {
            const t = now + i * interval;
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = 55 + (i % 2) * 8; // ドラムの低音
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.0, t);
            g.gain.linearRampToValueAtTime(0.09, t + 0.02);
            g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
            osc.connect(g);
            g.connect(this.masterVolume);
            osc.start(t);
            osc.stop(t + 0.18);
            nodes.push(osc, g);
        }
        this._pitchBgmNodes = nodes;
    }

    stopTensionBgm() {
        // 前回のノードをスケジュールから除去 (既に start/stop 済みなので放置でOK)
        this._pitchBgmNodes = [];
    }

    // --------------------------------------------------
    // 投球音 (既存 + ピッチャーキャラ特性対応)
    // --------------------------------------------------
    playPitch(type, isStrike, durationMs, charTraits = {}, minSweet = null, maxSweet = null) {
        if (!this.ctx) return null;
        const now = this.ctx.currentTime;
        const durationSec = durationMs / 1000;

        const osc = this.ctx.createOscillator();
        const gainNode = this.ctx.createGain();
        const panner = this.ctx.createStereoPanner();

        osc.connect(gainNode);
        gainNode.connect(panner);
        panner.connect(this.masterVolume);

        if (charTraits.sawNoise) {
            osc.type = 'sawtooth';
        } else {
            osc.type = 'triangle';
        }

        // 最終回劇的チャンス時の音響ブースト判定 (プレイヤーバッティング中かつ最終回同点・ビハインド)
        const s = typeof Game !== 'undefined' ? Game.state : null;
        const isLastInningClutch = s && (!s.isBottom) && (s.inning === s.maxInnings) && (s.score.player <= s.score.cpu);
        const freqMod = isLastInningClutch ? 150 : 0; // 大歓声に埋もれないよう周波数をシフト

        if (type === 'curve') {
            osc.frequency.setValueAtTime(350 + freqMod, now);
            osc.frequency.linearRampToValueAtTime(250 + freqMod, now + durationSec * 0.4);
            osc.frequency.exponentialRampToValueAtTime(800 + freqMod, now + durationSec);
        } else if (type === 'changeup') {
            osc.frequency.setValueAtTime(200 + freqMod, now);
            osc.frequency.linearRampToValueAtTime(380 + freqMod, now + durationSec);
        } else if (type === 'fork') {
            // フォーク: 急速落下・低音化
            osc.frequency.setValueAtTime(300 + freqMod, now);
            osc.frequency.linearRampToValueAtTime(280 + freqMod, now + durationSec * 0.7);
            osc.frequency.exponentialRampToValueAtTime(120 + freqMod, now + durationSec);
        } else if (type === 'split') {
            // スプリット: 高速縦変化・直前落下
            osc.frequency.setValueAtTime(320 + freqMod, now);
            osc.frequency.linearRampToValueAtTime(300 + freqMod, now + durationSec * 0.85);
            osc.frequency.exponentialRampToValueAtTime(200 + freqMod, now + durationSec);
        } else if (type === 'screw') {
            // スクリュー: 逆変化
            osc.frequency.setValueAtTime(360 + freqMod, now);
            osc.frequency.linearRampToValueAtTime(240 + freqMod, now + durationSec * 0.5);
            osc.frequency.exponentialRampToValueAtTime(550 + freqMod, now + durationSec);
        } else {
            osc.frequency.setValueAtTime(260 + freqMod, now);
            osc.frequency.exponentialRampToValueAtTime(750 + freqMod, now + durationSec);
        }

        const needsWobble = !isStrike || charTraits.wobble || charTraits.flutterSound;
        if (needsWobble) {
            const lfo = this.ctx.createOscillator();
            const lfoGain = this.ctx.createGain();
            lfo.type = 'sine';
            lfo.frequency.value = charTraits.flutterSound ? 25 : 12;
            lfoGain.gain.value = charTraits.wobbleDepth || 40;
            lfo.connect(lfoGain);
            lfoGain.connect(osc.frequency);
            lfo.start(now);
            lfo.stop(now + durationSec);
        }

        // 大歓声に負けないよう、ゲインを0.4から0.78へブースト
        const maxGain = isLastInningClutch ? 0.78 : 0.4;
        gainNode.gain.setValueAtTime(0.01, now);
        gainNode.gain.linearRampToValueAtTime(maxGain, now + durationSec * 0.85);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + durationSec + 0.05);

        const panDir = Math.random() < 0.5 ? -1 : 1;
        if (charTraits.scatterPanner) {
            panner.pan.setValueAtTime(0, now);
            for (let t = 0.05; t < durationSec; t += 0.1) {
                panner.pan.linearRampToValueAtTime((Math.random() * 2 - 1) * 0.85, now + t);
            }
        } else if (charTraits.extremePan) {
            panner.pan.setValueAtTime(panDir * 0.85, now);
            panner.pan.linearRampToValueAtTime(-panDir * 0.85, now + durationSec);
        } else if (type === 'curve') {
            // カーブ: 左右への大きな曲がり
            if (isStrike) {
                panner.pan.setValueAtTime(panDir * 0.7, now);
                panner.pan.linearRampToValueAtTime(-panDir * 0.3, now + durationSec);
            } else {
                panner.pan.setValueAtTime(panDir * 0.8, now);
                panner.pan.linearRampToValueAtTime(panDir * 0.2, now + durationSec);
            }
        } else if (type === 'screw') {
            // スクリュー: パン反転（カーブの左右逆）
            if (isStrike) {
                panner.pan.setValueAtTime(-panDir * 0.7, now);
                panner.pan.linearRampToValueAtTime(panDir * 0.3, now + durationSec);
            } else {
                panner.pan.setValueAtTime(-panDir * 0.8, now);
                panner.pan.linearRampToValueAtTime(-panDir * 0.2, now + durationSec);
            }
        } else if (isStrike) {
            panner.pan.setValueAtTime(panDir * 0.4, now);
            panner.pan.linearRampToValueAtTime(0, now + durationSec * 0.8);
        } else {
            panner.pan.setValueAtTime(panDir * 0.8, now);
            panner.pan.linearRampToValueAtTime(panDir * 0.7, now + durationSec);
        }

        osc.start(now);
        osc.stop(now + durationSec + 0.05);

        // 音声タイミングガイドのスケジュール
        let guideNodes = [];
        if (this.timingGuideEnabled && minSweet !== null && maxSweet !== null) {
            const targetTimeMs = (minSweet + maxSweet) / 2;
            guideNodes = this.scheduleTimingGuide(now, targetTimeMs, isLastInningClutch);
        }

        return { osc, gainNode, panner, startTime: performance.now(), guideNodes };
    }

    scheduleTimingGuide(startTimeSec, targetTimeMs, isClutchBoost = false) {
        if (!this.ctx) return [];
        const targetTimeSec = targetTimeMs / 1000;
        
        // 4拍のカウントダウン: 0%, 33%, 66%, 100%
        const steps = [0.0, 0.33, 0.66, 1.0];
        const nodes = [];

        steps.forEach((step, idx) => {
            const timePoint = startTimeSec + targetTimeSec * step;
            
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            const panner = this.ctx.createStereoPanner();

            osc.connect(gain);
            gain.connect(panner);
            panner.connect(this.masterVolume);

            panner.pan.setValueAtTime(0.0, timePoint);

            const pitchShift = isClutchBoost ? 180 : 0; // ガイドの周波数も大歓声と被らないように少し上げる

            if (idx === 3) {
                // ジャストミートの打点 (高いピン音)
                osc.type = 'sine';
                osc.frequency.setValueAtTime(950 + pitchShift, timePoint);
                gain.gain.setValueAtTime(0.0, timePoint);
                const meetGain = isClutchBoost ? 0.38 : 0.18;
                gain.gain.linearRampToValueAtTime(meetGain, timePoint + 0.005);
                gain.gain.exponentialRampToValueAtTime(0.001, timePoint + 0.12);
                
                osc.start(timePoint);
                osc.stop(timePoint + 0.12);
            } else {
                // カウントダウン音 (ピッ)
                osc.type = 'sine';
                osc.frequency.setValueAtTime(480 + pitchShift, timePoint);
                gain.gain.setValueAtTime(0.0, timePoint);
                const countGain = isClutchBoost ? 0.22 : 0.10;
                gain.gain.linearRampToValueAtTime(countGain, timePoint + 0.005);
                gain.gain.exponentialRampToValueAtTime(0.001, timePoint + 0.05);
                
                osc.start(timePoint);
                osc.stop(timePoint + 0.05);
            }

            nodes.push(osc);
        });

        return nodes;
    }

    // 空振り (風切り音)
    playWoosh(condition = 'normal') {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const bufferSize = this.ctx.sampleRate * 0.25;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(200, now);
        filter.frequency.exponentialRampToValueAtTime(condition === 'cold' ? 400 : 1000, now + 0.15);
        filter.Q.value = 4.0;

        const gainNode = this.ctx.createGain();
        gainNode.gain.setValueAtTime(0.5, now);
        gainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

        noise.connect(filter);
        filter.connect(gainNode);

        let dest = this.masterVolume;
        if (condition === 'cold') {
            const lpf = this.ctx.createBiquadFilter();
            lpf.type = 'lowpass';
            lpf.frequency.setValueAtTime(450, now);
            lpf.connect(this.masterVolume);
            dest = lpf;
        }
        gainNode.connect(dest);
        noise.start(now);

        // 絶好調時はキラキラ音を追加
        if (condition === 'super_hot') {
            const chime = this.ctx.createOscillator();
            chime.type = 'sine';
            chime.frequency.setValueAtTime(1600, now);
            chime.frequency.linearRampToValueAtTime(2800, now + 0.18);
            const cg = this.ctx.createGain();
            cg.gain.setValueAtTime(0.06, now);
            cg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
            chime.connect(cg);
            cg.connect(this.masterVolume);
            chime.start(now);
            chime.stop(now + 0.18);
        }
    }

    // --------------------------------------------------
    // 【ENHANCED】打球音 (種類別)
    // --------------------------------------------------
    // power: 0.0〜1.0, hitType: 'homerun'|'extra'|'single'|'foul'|'grounder'|'flyout'
    // power: 0.0〜1.0, hitType: 'homerun'|'extra'|'single'|'foul'|'grounder'|'flyout'|'triple'|'double'|'lineout'|'popup'
    // direction: 'left'|'center'|'right'
    playCrack(power = 0.8, hitType = 'single', condition = 'normal', direction = 'center') {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        let panValue = 0.0;
        if (direction === 'left') {
            panValue = -0.55;
        } else if (direction === 'right') {
            panValue = 0.55;
        }

        const panner = this.ctx.createStereoPanner();
        panner.pan.setValueAtTime(panValue, now);

        let dest = panner;
        panner.connect(this.masterVolume);

        if (condition === 'cold') {
            const lpf = this.ctx.createBiquadFilter();
            lpf.type = 'lowpass';
            lpf.frequency.setValueAtTime(500, now);
            lpf.connect(panner);
            dest = lpf;
        }

        // 絶好調時はキラキラーンという打撃音を重ねる
        if (condition === 'super_hot') {
            [1200, 1800, 2400].forEach((freq, idx) => {
                const chime = this.ctx.createOscillator();
                chime.type = 'sine';
                chime.frequency.setValueAtTime(freq, now + idx * 0.03);
                const cg = this.ctx.createGain();
                cg.gain.setValueAtTime(0.09, now + idx * 0.03);
                cg.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.03 + 0.35);
                chime.connect(cg);
                cg.connect(this.masterVolume);
                chime.start(now + idx * 0.03);
                chime.stop(now + idx * 0.03 + 0.35);
            });
        }

        if (hitType === 'homerun') {
            // ホームラン: 高くて重い快音 + 余韻
            const osc = this.ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1500, now);
            osc.frequency.exponentialRampToValueAtTime(120, now + 0.18);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(1.0, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
            osc.connect(g); g.connect(dest);
            osc.start(now); osc.stop(now + 0.22);

            // 高音の金属成分
            const osc2 = this.ctx.createOscillator();
            osc2.type = 'square';
            osc2.frequency.setValueAtTime(3200, now);
            const g2 = this.ctx.createGain();
            g2.gain.setValueAtTime(0.6, now);
            g2.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
            osc2.connect(g2); g2.connect(dest);
            osc2.start(now); osc2.stop(now + 0.04);

            // 打球が遠くへ飛んでいく音 (右→左へパン)
            setTimeout(() => this.playBallFlight(direction, 'homerun'), 60);

        } else if (hitType === 'grounder') {
            // ゴロ: こもった低音
            const osc = this.ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(300, now);
            osc.frequency.exponentialRampToValueAtTime(60, now + 0.10);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.5, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
            osc.connect(g); g.connect(dest);
            osc.start(now); osc.stop(now + 0.10);

            // ゴロの転がる飛翔音
            setTimeout(() => this.playBallFlight(direction, 'grounder'), 60);

        } else if (hitType === 'flyout' || hitType === 'fly' || hitType === 'popup') {
            // フライ: 軽くて高め
            const osc = this.ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(900 * power, now);
            osc.frequency.exponentialRampToValueAtTime(80, now + 0.13);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.55 * power, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
            osc.connect(g); g.connect(dest);
            osc.start(now); osc.stop(now + 0.13);

            // フライの飛翔音
            setTimeout(() => this.playBallFlight(direction, 'fly'), 60);

        } else if (hitType === 'foul') {
            // ファウル: 鋭いが芯を外れた音
            const osc = this.ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(700, now);
            osc.frequency.exponentialRampToValueAtTime(150, now + 0.09);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.4, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
            osc.connect(g); g.connect(dest);
            osc.start(now); osc.stop(now + 0.09);

            // ファウルの飛翔音
            setTimeout(() => this.playBallFlight(direction, 'foul'), 60);

        } else {
            // デフォルト (single / extra base)
            const osc = this.ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1200 * power, now);
            osc.frequency.exponentialRampToValueAtTime(100, now + 0.12);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.8, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
            osc.connect(g); g.connect(dest);
            osc.start(now); osc.stop(now + 0.12);

            const osc2 = this.ctx.createOscillator();
            osc2.type = 'square';
            osc2.frequency.setValueAtTime(2200, now);
            const g2 = this.ctx.createGain();
            g2.gain.setValueAtTime(0.5 * power, now);
            g2.gain.exponentialRampToValueAtTime(0.001, now + 0.02);
            osc2.connect(g2); g2.connect(dest);
            osc2.start(now); osc2.stop(now + 0.02);

            // 普通のヒットの飛翔音
            setTimeout(() => this.playBallFlight(direction, hitType), 60);
        }
    }

    // 【NEW】打球の飛翔音 (打撃方向と結果に応じた立体定位移動)
    playBallFlight(direction = 'center', hitType = 'single') {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        let dur = 1.0;
        let startPan = 0.0;
        let endPan = 0.0;

        if (hitType === 'homerun') {
            dur = 1.8;
        } else if (hitType === 'double' || hitType === 'triple' || hitType === 'extra') {
            dur = 1.4;
        } else if (hitType === 'grounder') {
            dur = 0.8;
        } else if (hitType === 'foul') {
            dur = 0.9;
        } else {
            dur = 1.0;
        }

        if (direction === 'left') {
            startPan = -0.05;
            endPan = -0.92;
        } else if (direction === 'right') {
            startPan = 0.05;
            endPan = 0.92;
        } else {
            // center
            startPan = 0.0;
            endPan = (Math.random() * 0.2 - 0.1);
        }

        const osc = this.ctx.createOscillator();
        const panner = this.ctx.createStereoPanner();
        const g = this.ctx.createGain();

        if (hitType === 'grounder') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(180, now);
            osc.frequency.linearRampToValueAtTime(80, now + dur);
            
            g.gain.setValueAtTime(0.20, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + dur);
        } else if (hitType === 'foul') {
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(500, now);
            osc.frequency.exponentialRampToValueAtTime(250, now + dur);
            g.gain.setValueAtTime(0.08, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + dur);
        } else {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(850, now);
            osc.frequency.exponentialRampToValueAtTime(200, now + dur);
            
            g.gain.setValueAtTime(0.12, now);
            g.gain.linearRampToValueAtTime(0.18, now + 0.25);
            g.gain.exponentialRampToValueAtTime(0.001, now + dur);
        }

        panner.pan.setValueAtTime(startPan, now);
        panner.pan.linearRampToValueAtTime(endPan, now + dur);

        osc.connect(g);
        g.connect(panner);
        panner.connect(this.masterVolume);
        
        osc.start(now);
        osc.stop(now + dur);
    }

    // キャッチャーミットに収まる音
    playCatch() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(30, now + 0.08);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.7, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        osc.connect(gain);
        gain.connect(this.masterVolume);
        osc.start(now);
        osc.stop(now + 0.08);
    }

    // --------------------------------------------------
    // 【ENHANCED】観客歓声 (強度レベル対応)
    // --------------------------------------------------
    // level: 'small'|'medium'|'big'|'mega'
    playCrowdCheer(durationSec = 3.0, level = 'medium') {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        const volumeMap = { small: 0.12, medium: 0.22, big: 0.38, mega: 0.55 };
        const freqMap   = { small: 400,  medium: 500,  big: 650,  mega: 800 };
        const maxVol  = volumeMap[level] || 0.22;
        const peakFreq = freqMap[level] || 500;

        // メインノイズ
        const bufSize = this.ctx.sampleRate * durationSec;
        const buf = this.ctx.createBuffer(2, bufSize, this.ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < bufSize; i++) d[i] = Math.random() * 2 - 1;
        }
        const noise = this.ctx.createBufferSource();
        noise.buffer = buf;

        const bpf = this.ctx.createBiquadFilter();
        bpf.type = 'bandpass';
        bpf.frequency.setValueAtTime(peakFreq, now);
        bpf.Q.value = 0.8;

        // 歓声の盛り上がり → 徐々に引く
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.01, now);
        gain.gain.linearRampToValueAtTime(maxVol, now + 0.35);
        gain.gain.setValueAtTime(maxVol * 0.85, now + durationSec * 0.55);
        gain.gain.exponentialRampToValueAtTime(0.001, now + durationSec);

        noise.connect(bpf);
        bpf.connect(gain);
        gain.connect(this.masterVolume);
        noise.start(now);

        // ホイッスル成分 (bigとmegaのみ)
        if (level === 'big' || level === 'mega') {
            [0.1, 0.35, 0.7].forEach(delay => {
                const osc = this.ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1800 + Math.random() * 400, now + delay);
                const og = this.ctx.createGain();
                og.gain.setValueAtTime(0.04, now + delay);
                og.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.3);
                osc.connect(og);
                og.connect(this.masterVolume);
                osc.start(now + delay);
                osc.stop(now + delay + 0.3);
            });
        }
    }

    // --------------------------------------------------
    // 【ENHANCED】ホームランファンファーレ (グランドスラム版あり)
    // --------------------------------------------------
    playHomerunFanfare(isGrandSlam = false) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        const melody = isGrandSlam ? [
            { freq: 261.63, time: 0   },
            { freq: 329.63, time: 0.08},
            { freq: 392.00, time: 0.16},
            { freq: 523.25, time: 0.24},
            { freq: 659.25, time: 0.32},
            { freq: 783.99, time: 0.40},
            { freq: 1046.50,time: 0.48},
            { freq: 1318.51,time: 0.58},  // 追加音 E6
            { freq: 1568.00,time: 0.68},  // 追加音 G6
        ] : [
            { freq: 261.63, time: 0   },
            { freq: 329.63, time: 0.1 },
            { freq: 392.00, time: 0.2 },
            { freq: 523.25, time: 0.3 },
            { freq: 659.25, time: 0.4 },
            { freq: 783.99, time: 0.5 },
            { freq: 1046.50,time: 0.6 },
        ];

        melody.forEach(note => {
            ['sine', 'triangle'].forEach((type, ti) => {
                const osc = this.ctx.createOscillator();
                osc.type = type;
                osc.frequency.setValueAtTime(note.freq, now + note.time);
                const g = this.ctx.createGain();
                g.gain.setValueAtTime(ti === 0 ? 0.18 : 0.07, now + note.time);
                g.gain.exponentialRampToValueAtTime(0.001, now + note.time + (isGrandSlam ? 0.45 : 0.3));
                osc.connect(g);
                g.connect(this.masterVolume);
                osc.start(now + note.time);
                osc.stop(now + note.time + (isGrandSlam ? 0.45 : 0.3));
            });
        });
    }

    // --------------------------------------------------
    // 【ENHANCED】審判コール
    // --------------------------------------------------
    playSignal(type) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        if (type === 'strike') {
            // 審判の「ストライク！」: 鋭いブザー
            const osc = this.ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.linearRampToValueAtTime(140, now + 0.18);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.18, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
            osc.connect(g); g.connect(this.masterVolume);
            osc.start(now); osc.stop(now + 0.22);

        } else if (type === 'out') {
            // アウト: 重くて低い2段階ブザー
            [0, 0.22].forEach((delay, i) => {
                const osc = this.ctx.createOscillator();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(i === 0 ? 180 : 150, now + delay);
                const g = this.ctx.createGain();
                g.gain.setValueAtTime(0.22, now + delay);
                g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.18);
                osc.connect(g); g.connect(this.masterVolume);
                osc.start(now + delay); osc.stop(now + delay + 0.18);
            });

        } else if (type === 'ball') {
            // ボール: 高めの2ピピッ
            [0, 0.13].forEach(delay => {
                const osc = this.ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(650, now + delay);
                const g = this.ctx.createGain();
                g.gain.setValueAtTime(0.15, now + delay);
                g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.09);
                osc.connect(g); g.connect(this.masterVolume);
                osc.start(now + delay); osc.stop(now + delay + 0.09);
            });

        } else if (type === 'safe' || type === 'hit') {
            // ヒット/セーフ: 明るい和音
            [880, 1100, 1320, 1650].forEach((freq, i) => {
                const osc = this.ctx.createOscillator();
                osc.type = i % 2 === 0 ? 'sine' : 'triangle';
                osc.frequency.setValueAtTime(freq, now);
                const g = this.ctx.createGain();
                g.gain.setValueAtTime(0.09, now);
                g.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
                osc.connect(g); g.connect(this.masterVolume);
                osc.start(now); osc.stop(now + 0.4);
            });
        }
    }

    // --------------------------------------------------
    // 【NEW】三振アウト (ドラマチックな演出)
    // --------------------------------------------------
    playStrikeout() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        // ズシン × 3 (タイコの連打)
        [0, 0.28, 0.52].forEach((delay, i) => {
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(80 - i * 8, now + delay);
            osc.frequency.exponentialRampToValueAtTime(25, now + delay + 0.22);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.55, now + delay);
            g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.22);
            osc.connect(g); g.connect(this.masterVolume);
            osc.start(now + delay); osc.stop(now + delay + 0.22);
        });
        // 最後にシュン音
        setTimeout(() => {
            if (!this.ctx) return;
            const n = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(300, n);
            osc.frequency.exponentialRampToValueAtTime(50, n + 0.4);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.12, n);
            g.gain.exponentialRampToValueAtTime(0.001, n + 0.4);
            osc.connect(g); g.connect(this.masterVolume);
            osc.start(n); osc.stop(n + 0.4);
        }, 620);
    }

    // --------------------------------------------------
    // 【NEW】走者の立体音響 (塁間を走る足音)
    // --------------------------------------------------
    playRunnerProgress(startBase, endBase, durationSec = 1.0) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        // 各塁のパン設定 (0: 本塁, 1: 1塁, 2: 2塁, 3: 3塁, 4: 本塁)
        const basePans = {
            0: 0.0,
            1: 0.7,
            2: 0.0,
            3: -0.7,
            4: 0.0
        };

        const startPan = basePans[startBase] !== undefined ? basePans[startBase] : 0.0;
        const endPan = basePans[endBase] !== undefined ? basePans[endBase] : 0.0;

        const stepsCount = Math.max(Math.floor(durationSec * 9), 2);
        const interval = durationSec / stepsCount;

        for (let i = 0; i < stepsCount; i++) {
            const stepTime = now + i * interval;
            const progress = i / stepsCount;
            const currentPan = startPan + (endPan - startPan) * progress;

            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(110 + Math.random() * 25, stepTime);
            osc.frequency.exponentialRampToValueAtTime(45, stepTime + 0.06);

            const panner = this.ctx.createStereoPanner();
            panner.pan.setValueAtTime(currentPan, stepTime);

            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.18, stepTime);
            g.gain.exponentialRampToValueAtTime(0.001, stepTime + 0.06);

            osc.connect(g);
            g.connect(panner);
            panner.connect(this.masterVolume);

            osc.start(stepTime);
            osc.stop(stepTime + 0.06);
        }
    }

    // --------------------------------------------------
    // 【NEW】3アウトチェンジ (試合の区切り感)
    // --------------------------------------------------
    playThreeOutChange() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        // ドン・ドン・ドーン
        const hits = [
            { t: 0,    freq: 110, dur: 0.25 },
            { t: 0.30, freq: 100, dur: 0.25 },
            { t: 0.62, freq: 90,  dur: 0.5  },
        ];
        hits.forEach(h => {
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(h.freq, now + h.t);
            osc.frequency.exponentialRampToValueAtTime(28, now + h.t + h.dur);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.6, now + h.t);
            g.gain.exponentialRampToValueAtTime(0.001, now + h.t + h.dur);
            osc.connect(g); g.connect(this.masterVolume);
            osc.start(now + h.t); osc.stop(now + h.t + h.dur);
        });
        // 笛
        setTimeout(() => {
            if (!this.ctx) return;
            const n = this.ctx.currentTime;
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(1600, n);
            osc.frequency.linearRampToValueAtTime(1200, n + 0.35);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.12, n);
            g.gain.exponentialRampToValueAtTime(0.001, n + 0.35);
            osc.connect(g); g.connect(this.masterVolume);
            osc.start(n); osc.stop(n + 0.35);
        }, 900);
    }

    // --------------------------------------------------
    // 【NEW】ホームイン音 (ランナーが本塁を踏む)
    // --------------------------------------------------
    playHomeIn(runs = 1) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        // ドタドタ走る音 → ベースを踏む "ドン"
        for (let i = 0; i < runs; i++) {
            const baseDelay = i * 0.35;
            // 足音 (細かいノイズパルス)
            for (let s = 0; s < 4; s++) {
                const t = now + baseDelay + s * 0.07;
                const osc = this.ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(120, t);
                osc.frequency.exponentialRampToValueAtTime(50, t + 0.05);
                const g = this.ctx.createGain();
                g.gain.setValueAtTime(0.2, t);
                g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
                osc.connect(g); g.connect(this.masterVolume);
                osc.start(t); osc.stop(t + 0.05);
            }
            // ホームベースを踏む音
            const ht = now + baseDelay + 0.32;
            const hosc = this.ctx.createOscillator();
            hosc.type = 'sine';
            hosc.frequency.setValueAtTime(200, ht);
            hosc.frequency.exponentialRampToValueAtTime(40, ht + 0.15);
            const hg = this.ctx.createGain();
            hg.gain.setValueAtTime(0.45, ht);
            hg.gain.exponentialRampToValueAtTime(0.001, ht + 0.15);
            hosc.connect(hg); hg.connect(this.masterVolume);
            hosc.start(ht); hosc.stop(ht + 0.15);
        }
    }

    // --------------------------------------------------
    // 【NEW】キャラクター登場音 (個性別)
    // --------------------------------------------------
    playCharacterEntrance(charTraits = {}) {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;

        if (charTraits.sawNoise) {
            // 木切り機: のこぎり波の爆音
            const osc = this.ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, now);
            osc.frequency.linearRampToValueAtTime(400, now + 0.15);
            osc.frequency.linearRampToValueAtTime(80, now + 0.35);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.25, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.38);
            osc.connect(g); g.connect(this.masterVolume);
            osc.start(now); osc.stop(now + 0.38);

        } else if (charTraits.rageMode || charTraits.heavyL) {
            // 怒り系: 低くて重い轟音
            const osc = this.ctx.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(60, now);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.3, now);
            g.gain.linearRampToValueAtTime(0.0, now + 0.5);
            osc.connect(g); g.connect(this.masterVolume);
            osc.start(now); osc.stop(now + 0.5);

        } else if (charTraits.cryBaby) {
            // 泣き虫: 上下するか細い音
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(600, now);
            osc.frequency.linearRampToValueAtTime(400, now + 0.2);
            osc.frequency.linearRampToValueAtTime(550, now + 0.4);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.1, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
            osc.connect(g); g.connect(this.masterVolume);
            osc.start(now); osc.stop(now + 0.45);

        } else if (charTraits.heavySleep) {
            // 眠い: ゆっくりした低音
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(200, now);
            osc.frequency.linearRampToValueAtTime(120, now + 0.8);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.0, now);
            g.gain.linearRampToValueAtTime(0.12, now + 0.3);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.9);
            osc.connect(g); g.connect(this.masterVolume);
            osc.start(now); osc.stop(now + 0.9);

        } else if (charTraits.pinkAura) {
            // ラブラブ: 甘くきらめくアルペジオ
            [523.25, 659.25, 783.99, 1046.50].forEach((freq, i) => {
                const osc = this.ctx.createOscillator();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(freq, now + i * 0.08);
                const g = this.ctx.createGain();
                g.gain.setValueAtTime(0.1, now + i * 0.08);
                g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.3);
                osc.connect(g); g.connect(this.masterVolume);
                osc.start(now + i * 0.08); osc.stop(now + i * 0.08 + 0.3);
            });

        } else {
            // デフォルト: 短いピポッ
            const osc = this.ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, now);
            osc.frequency.exponentialRampToValueAtTime(440, now + 0.12);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.1, now);
            g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
            osc.connect(g); g.connect(this.masterVolume);
            osc.start(now); osc.stop(now + 0.14);
        }
    }

    // --------------------------------------------------
    // 【NEW】勝利ジングル (試合終了)
    // --------------------------------------------------
    playVictoryJingle() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        // 明るく跳ねるメロディ
        const notes = [
            { f: 523.25, t: 0.00 }, { f: 659.25, t: 0.12 },
            { f: 783.99, t: 0.24 }, { f: 1046.50, t: 0.38 },
            { f: 783.99, t: 0.52 }, { f: 1046.50, t: 0.64 },
            { f: 1318.51, t: 0.78 },
        ];
        notes.forEach(n => {
            const osc = this.ctx.createOscillator();
            osc.type = 'square';
            osc.frequency.setValueAtTime(n.f, now + n.t);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.12, now + n.t);
            g.gain.exponentialRampToValueAtTime(0.001, now + n.t + 0.25);
            osc.connect(g); g.connect(this.masterVolume);
            osc.start(now + n.t); osc.stop(now + n.t + 0.25);
        });
    }

    // --------------------------------------------------
    // 【NEW】敗北音
    // --------------------------------------------------
    playDefeatSound() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        const notes = [
            { f: 440, t: 0.00 }, { f: 349.23, t: 0.22 },
            { f: 293.66, t: 0.44 }, { f: 220, t: 0.68 },
        ];
        notes.forEach(n => {
            const osc = this.ctx.createOscillator();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(n.f, now + n.t);
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(0.13, now + n.t);
            g.gain.exponentialRampToValueAtTime(0.001, now + n.t + 0.3);
            osc.connect(g); g.connect(this.masterVolume);
            osc.start(now + n.t); osc.stop(now + n.t + 0.3);
        });
    }

    // --------------------------------------------------
    // 【NEW】ピンチBGM (フォアボール/満塁警告音)
    // --------------------------------------------------
    playPinchWarning() {
        if (!this.ctx) return;
        const now = this.ctx.currentTime;
        // 低音のパルスと短い上昇音
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90, now);
        osc.frequency.linearRampToValueAtTime(200, now + 0.15);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.18, now);
        g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
        osc.connect(g); g.connect(this.masterVolume);
        osc.start(now); osc.stop(now + 0.2);

        setTimeout(() => {
            if (!this.ctx) return;
            const n = this.ctx.currentTime;
            const o = this.ctx.createOscillator();
            o.type = 'sine';
            o.frequency.setValueAtTime(300, n);
            o.frequency.linearRampToValueAtTime(500, n + 0.2);
            const gg = this.ctx.createGain();
            gg.gain.setValueAtTime(0.1, n);
            gg.gain.exponentialRampToValueAtTime(0.001, n + 0.25);
            o.connect(gg); gg.connect(this.masterVolume);
            o.start(n); o.stop(n + 0.25);
        }, 230);
    }
}

// 効果音シンセサイザーのインスタンス
const synth = new AudioSynth();

// ==========================================
// ゲームエンジン / ルール & 状態管理
// ==========================================
const Game = {
    // 難易度設定値
    DIFFICULTIES: {
        easy: { name: "かんたん", strikeRate: 0.70, swingAtStrike: 0.60, swingAtBall: 0.45, cpuMissRate: 0.40 },
        medium: { name: "ふつう", strikeRate: 0.55, swingAtStrike: 0.78, swingAtBall: 0.25, cpuMissRate: 0.20 },
        hard: { name: "むずかしい", strikeRate: 0.40, swingAtStrike: 0.90, swingAtBall: 0.05, cpuMissRate: 0.05 }
    },

    // 投球パラメータ
    PITCH_TYPES: {
        fastball: { name: "ストレート", duration: 800, minSweet: 550, maxSweet: 720 },
        curve: { name: "カーブ", duration: 1200, minSweet: 900, maxSweet: 1100 },
        changeup: { name: "チェンジアップ", duration: 1600, minSweet: 1300, maxSweet: 1500 },
        fork: { name: "フォーク", duration: 1100, minSweet: 800, maxSweet: 980 },
        split: { name: "スプリット", duration: 900, minSweet: 650, maxSweet: 810 },
        screw: { name: "スクリュー", duration: 1300, minSweet: 950, maxSweet: 1150 }
    },

    lastAnnouncedText: null,

    getOutPrefix(message) {
        if (!message) return "アウト！ ";
        if (message.includes("セカンド")) return "セカンドアウト！ ";
        if (message.includes("ショート")) return "ショートアウト！ ";
        if (message.includes("サード")) return "サードアウト！ ";
        if (message.includes("ファースト")) return "ファーストアウト！ ";
        if (message.includes("ピッチャー")) return "ピッチャーアウト！ ";
        if (message.includes("キャッチャー")) return "キャッチャーアウト！ ";
        if (message.includes("レフト")) return "レフトアウト！ ";
        if (message.includes("センター")) return "センターアウト！ ";
        if (message.includes("ライト")) return "ライトアウト！ ";
        if (message.includes("三振")) return "三振アウト！ ";
        return "アウト！ ";
    },

    // チャレンジモードの状態
    timingPracticePitches: 0,
    timingPracticeErrors: [],
    survivalLives: 3,
    survivalStreak: 0,

    // 状態変数
    state: {
        currentScreen: 'lobby', // 'lobby', 'game'
        difficulty: 'medium',
        maxInnings: 3,
        inning: 1,
        isBottom: false, // false = 表(User攻撃), true = 裏(CPU攻撃)
        
        score: { player: 0, cpu: 0 },
        inningRuns: {
            player: [], // 各回の得点
            cpu: []
        },
        
        balls: 0,
        strikes: 0,
        outs: 0,
        runners: [false, false, false], // 1塁, 2塁, 3塁 (true=ランナーあり)
        
        activePitch: null, // 現在飛行中の投球情報
        isPitchInFlight: false,
        pitchTimeout: null,
        animationFrameId: null,
        
        practiceMode: false,
        
        // CPUキャラクターシステム用の状態
        cpuLineup: [],
        currentCpuBatterIndex: 0,
        cpuPitcher: null,
        
        // ユーザー投球用のパラメータ
        userPitchSpeed: 'normal'
    },

    // 初期化
    init() {
        this.cacheDOM();
        this.bindEvents();
        this.setupKeyboardShortcuts();
        this.updateStatsUI();
    },

    cacheDOM() {
        this.dom = {
            lobbyScreen: document.getElementById('lobby-screen'),
            gameScreen: document.getElementById('game-screen'),
            startBtn: document.getElementById('start-game-btn'),
            difficultySelect: document.getElementById('ai-difficulty'),
            inningsSelect: document.getElementById('game-innings'),
            gameModeSelect: document.getElementById('game-mode'),
            
            // スコアボード
            inningDisplay: document.getElementById('inning-display'),
            playerRunsList: document.getElementById('player-runs-list'),
            cpuRunsList: document.getElementById('cpu-runs-list'),
            playerScore: document.getElementById('player-score'),
            cpuScore: document.getElementById('cpu-score'),
            
            // インジケーター
            ballIndicators: document.getElementById('ball-indicators'),
            strikeIndicators: document.getElementById('strike-indicators'),
            outIndicators: document.getElementById('out-indicators'),
            base1: document.getElementById('base-1'),
            base2: document.getElementById('base-2'),
            base3: document.getElementById('base-3'),
            runnersStatusText: document.getElementById('runners-status-text'),
            
            // コントロール
            currentModeTitle: document.getElementById('current-mode-title'),
            pitcherInfo: document.getElementById('pitcher-info'),
            battingControls: document.getElementById('batting-controls'),
            pitchingControls: document.getElementById('pitching-controls'),
            battingReadyBtn: document.getElementById('batting-ready-btn'),
            swingBtn: document.getElementById('swing-btn'),
            pitchThrowBtn: document.getElementById('pitch-throw-btn'),
            btnPracticePitch: document.getElementById('btn-practice-pitch'),
            volumeSlider: document.getElementById('sound-volume'),
            
            // ビジュアル用タイミングバー
            timingCursor: document.getElementById('timing-cursor'),
            timingTarget: document.querySelector('.timing-target-zone'),
            
            // ログ & アナウンサー
            gameLog: document.getElementById('game-log'),
            srAnnouncer: document.getElementById('sr-announcer'),
            
            // モーダル
            modalContainer: document.getElementById('modal-container'),
            modalTitle: document.getElementById('modal-title'),
            modalBody: document.getElementById('modal-body'),
            modalCloseBtn: document.getElementById('modal-close-btn'),
            
            // 戦績表示
            statsGames: document.getElementById('stats-games'),
            statsRecord: document.getElementById('stats-record'),
            statsAvg: document.getElementById('stats-avg'),
            statsHr: document.getElementById('stats-hr'),
            statsTournament: document.getElementById('stats-tournament'),
            statsBestError: document.getElementById('stats-best-error'),
            statsBestSurvival: document.getElementById('stats-best-survival'),
            resetStatsBtn: document.getElementById('reset-stats-btn')
        };
    },

    bindEvents() {
        // ゲーム開始
        this.dom.startBtn.addEventListener('click', () => {
            const vol = parseInt(this.dom.volumeSlider.value);
            synth.init(vol);
            this.startGame();
        });

        // 音量調節
        this.dom.volumeSlider.addEventListener('input', (e) => {
            synth.setVolume(parseInt(e.target.value));
        });

        // バッティングアクション
        this.dom.battingReadyBtn.addEventListener('click', () => this.prepareForPitch());
        this.dom.swingBtn.addEventListener('click', () => this.triggerSwing());

        // ピッチングアクション
        this.dom.pitchThrowBtn.addEventListener('click', () => this.triggerPitch());

        // 球速ラジオボタンの監視
        document.querySelectorAll('input[name="pitch-speed"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.state.userPitchSpeed = e.target.value;
                this.announce(`球速を「${this.getSpeedName(e.target.value)}」に設定しました。`, 'polite');
            });
        });

        // プラクティスモード切り替え
        this.dom.btnPracticePitch.addEventListener('click', () => this.togglePracticeMode());

        // モーダル閉じる
        this.dom.modalCloseBtn.addEventListener('click', () => this.closeModal());

        // 戦績リセット
        if (this.dom.resetStatsBtn) {
            this.dom.resetStatsBtn.addEventListener('click', () => {
                if (confirm("これまでの通算戦績をすべてリセットしますか？")) {
                    localStorage.removeItem('universal_baseball_stats');
                    this.updateStatsUI();
                    this.announce("戦績をすべてリセットしました。", 'assertive');
                }
            });
        }
    },

    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            const key = e.key.toLowerCase();

            // Escapeキーはモーダルが開いていればいつでも閉じる
            if (key === 'escape' || key === 'esc') {
                if (!this.dom.modalContainer.classList.contains('hidden')) {
                    e.preventDefault();
                    this.closeModal();
                    return;
                }
            }

            // ゲーム画面じゃないときは無視
            if (this.state.currentScreen !== 'game') return;

            // Sキーによるステータス読み上げ
            if (key === 's') {
                e.preventDefault();
                this.readGameStatus();
                return;
            }

            // Gキーによるタイミングガイドのオン/オフ切り替え
            if (key === 'g') {
                e.preventDefault();
                synth.timingGuideEnabled = !synth.timingGuideEnabled;
                const statusStr = synth.timingGuideEnabled ? "オン" : "オフ";
                this.announce(`タイミングガイド音を${statusStr}にしました。`, 'assertive');
                return;
            }

            // Rキーによる直前の実況ログの再読み上げ
            if (key === 'r') {
                e.preventDefault();
                if (this.lastAnnouncedText) {
                    this.announce(this.lastAnnouncedText, 'assertive', false);
                } else {
                    this.announce("読み上げる実況ログがありません。", 'polite', false);
                }
                return;
            }

            // Hキーによるヘルプ画面の表示
            if (key === 'h') {
                e.preventDefault();
                this.showHelpModal();
                return;
            }

            // 1. バッティング中のスイング (スペースキー)
            if (key === ' ' || key === 'spacebar') {
                // デフォルトのスクロール動作を防ぐ
                e.preventDefault();
                if (!this.dom.swingBtn.disabled && this.state.isPitchInFlight) {
                    this.triggerSwing();
                }
            }

            // 2. エンターキーによる準備・投球・進む
            if (key === 'enter') {
                e.preventDefault();
                if (!this.dom.modalContainer.classList.contains('hidden')) {
                    // モーダルが開いている時はモーダルを閉じる
                    this.closeModal();
                } else if (!this.state.isBottom) {
                    // 表の攻撃中：「投球要求」
                    if (!this.dom.battingReadyBtn.disabled) {
                        this.prepareForPitch();
                    }
                } else {
                    // 裏の守備中：「投球する」
                    if (!this.dom.pitchingControls.classList.contains('hidden')) {
                        this.triggerPitch();
                    }
                }
            }

            // 3. 数字キーによる守備時の球種選択 (1, 2, 3, 4, 5, 6)
            if (this.state.isBottom && !this.dom.pitchingControls.classList.contains('hidden')) {
                if (key === '1') {
                    document.querySelector('input[name="pitch-type"][value="fastball"]').checked = true;
                    this.announce("ストレートを選択しました", 'polite');
                } else if (key === '2') {
                    document.querySelector('input[name="pitch-type"][value="curve"]').checked = true;
                    this.announce("カーブを選択しました", 'polite');
                } else if (key === '3') {
                    document.querySelector('input[name="pitch-type"][value="changeup"]').checked = true;
                    this.announce("チェンジアップを選択しました", 'polite');
                } else if (key === '4') {
                    document.querySelector('input[name="pitch-type"][value="fork"]').checked = true;
                    this.announce("フォークを選択しました", 'polite');
                } else if (key === '5') {
                    document.querySelector('input[name="pitch-type"][value="split"]').checked = true;
                    this.announce("スプリットを選択しました", 'polite');
                } else if (key === '6') {
                    document.querySelector('input[name="pitch-type"][value="screw"]').checked = true;
                    this.announce("スクリューを選択しました", 'polite');
                }
            }

            // 3b. 数字キーによる打撃時の狙い球宣言 (1, 2, 3, 4, 5, 6, 0)
            if (!this.state.isBottom && !this.dom.battingControls.classList.contains('hidden')) {
                if (key === '1') {
                    const r = document.querySelector('input[name="guess-type"][value="fastball"]');
                    if (r) r.checked = true;
                    this.announce("狙い球：ストレートに設定しました", 'polite');
                } else if (key === '2') {
                    const r = document.querySelector('input[name="guess-type"][value="curve"]');
                    if (r) r.checked = true;
                    this.announce("狙い球：カーブに設定しました", 'polite');
                } else if (key === '3') {
                    const r = document.querySelector('input[name="guess-type"][value="changeup"]');
                    if (r) r.checked = true;
                    this.announce("狙い球：チェンジアップに設定しました", 'polite');
                } else if (key === '4') {
                    const r = document.querySelector('input[name="guess-type"][value="fork"]');
                    if (r) r.checked = true;
                    this.announce("狙い球：フォークに設定しました", 'polite');
                } else if (key === '5') {
                    const r = document.querySelector('input[name="guess-type"][value="split"]');
                    if (r) r.checked = true;
                    this.announce("狙い球：スプリットに設定しました", 'polite');
                } else if (key === '6') {
                    const r = document.querySelector('input[name="guess-type"][value="screw"]');
                    if (r) r.checked = true;
                    this.announce("狙い球：スクリューに設定しました", 'polite');
                } else if (key === '0') {
                    const r = document.querySelector('input[name="guess-type"][value=""]');
                    if (r) r.checked = true;
                    this.announce("狙い球：解除しました", 'polite');
                }
            }

            // 4. 矢印キーによる守備時の球速調整 (↑ / ↓)
            if (this.state.isBottom && !this.dom.pitchingControls.classList.contains('hidden')) {
                if (key === 'arrowup' || key === 'up') {
                    e.preventDefault();
                    this.adjustPitchSpeed(1);
                } else if (key === 'arrowdown' || key === 'down') {
                    e.preventDefault();
                    this.adjustPitchSpeed(-1);
                }
            }
        });
    },

    // スクリーンリーダーと画面ログの両方に通知を送信する
    announce(text, priority = 'assertive', writeToLog = true) {
        if (writeToLog) {
            this.lastAnnouncedText = text;
        }

        // 劇的イベントのオーディオ演出
        if (writeToLog) {
            if (text.includes("【ここで代打！】")) {
                synth.playCharacterEntrance({ pinkAura: true });
                setTimeout(() => synth.playCrowdCheer(4.5, 'mega'), 250);
            } else if (text.includes("【CPUチーム代打起用！】") || text.includes("【劇的サヨナラのピンチ！】")) {
                synth.playCharacterEntrance({ sawNoise: true });
                setTimeout(() => synth.playCrowdCheer(4.5, 'big'), 250);
            } else if (text.includes("【劇的チャンス！】")) {
                synth.boostAmbient(0.12, 6.0);
                setTimeout(() => synth.playCrowdCheer(3.8, 'big'), 100);
            }
        }

        // スクリーンリーダー用のライブリージョンにテキストを書き込む
        this.dom.srAnnouncer.textContent = ""; // 一旦クリアして強制読み上げを誘発
        setTimeout(() => {
            this.dom.srAnnouncer.setAttribute('aria-live', priority);
            this.dom.srAnnouncer.textContent = text;
        }, 30);

        if (!writeToLog) return;

        // ビジュアルログに追加
        const p = document.createElement('p');
        p.className = 'log-entry';
        
        // テキスト内容に応じたカラークラス
        if (text.includes("ストライク")) p.classList.add('strike');
        else if (text.includes("ボール") && !text.includes("ヒット")) p.classList.add('ball');
        else if (text.includes("ヒット") || text.includes("シングル") || text.includes("２塁打") || text.includes("３塁打")) p.classList.add('hit');
        else if (text.includes("ホームラン")) p.classList.add('homerun');
        else if (text.includes("アウト")) p.classList.add('strike');

        p.textContent = text;
        this.dom.gameLog.appendChild(p);
        this.dom.gameLog.scrollTop = this.dom.gameLog.scrollHeight;
    },

    showHelpModal() {
        const content = `
            <div class="help-content" style="text-align: left; max-height: 400px; overflow-y: auto; padding: 10px; font-size: 14px; line-height: 1.6; color: #fff;">
                <p><strong>【ゲームのルール】</strong><br>
                音を頼りに遊ぶ野球ゲームです。攻撃時は投球が近づくタイミングに合わせてスペースキーでスイングします。タイミングガイド音（Gキーでオンオフ可能）を参考に、最後の高音（ジャストミートの打点）で振るとヒットになりやすいです。狙い打ちが当たると打ちやすくなります。</p>
                
                <p><strong>【バッティング操作（攻撃時）】</strong><br>
                ・<strong>スペースキー</strong>：スイング（タイミングよく振る）<br>
                ・<strong>Enterキー</strong>：次の投球を要求する（打席に入る）<br>
                ・<strong>1 / 2 / 3 キー</strong>：狙い球を設定（1:ストレート, 2:カーブ, 3:チェンジアップ）<br>
                ・<strong>4 / 5 / 6 キー</strong>：狙い球を設定（4:フォーク, 5:スプリット, 6:スクリュー）<br>
                ・<strong>0 キー</strong>：狙い球の設定を解除</p>
                
                <p><strong>【ピッチング操作（守備時）】</strong><br>
                ・<strong>1 / 2 / 3 キー</strong>：投げる球種を選択（1:ストレート, 2:カーブ, 3:チェンジアップ）<br>
                ・<strong>4 / 5 / 6 キー</strong>：投げる球種を選択（4:フォーク, 5:スプリット, 6:スクリュー）<br>
                ・<strong>矢印キー ↑ / ↓</strong>：球速を調整（はやい・ふつう・おそい）<br>
                ・<strong>Enterキー</strong>：投球する</p>
                
                <p><strong>【共通操作】</strong><br>
                ・<strong>H キー</strong>：この操作説明を表示する<br>
                ・<strong>S キー</strong>：現在のイニング・点数・カウント・ランナー情報を読み上げる<br>
                ・<strong>R キー</strong>：直前の実況アナウンスを再読み上げする<br>
                ・<strong>G キー</strong>：打撃時のタイミングガイド音のオン/オフ切り替え</p>
            </div>
        `;
        this.showModal("操作方法とルール説明", content);
    },

    // モーダルダイアログの表示
    showModal(title, message, callback) {
        this.dom.modalTitle.textContent = title;
        this.dom.modalBody.innerHTML = typeof message === 'string' ? `<p>${message}</p>` : message;
        this.dom.modalContainer.classList.remove('hidden');
        this.dom.modalCloseBtn.focus();
        this.modalCallback = callback;
        this.announce(`${title}。${this.dom.modalBody.textContent}。エンターキーを押して次に進みます。`, 'assertive');
    },

    closeModal() {
        this.dom.modalContainer.classList.add('hidden');
        if (this.modalCallback) {
            const cb = this.modalCallback;
            this.modalCallback = null;
            cb();
        }
    },

    async startGame(forceStage = null, forceDifficulty = null) {
        const gameMode = this.dom.gameModeSelect ? this.dom.gameModeSelect.value : 'normal';
        let difficulty = this.dom.difficultySelect.value;
        let maxInnings = parseInt(this.dom.inningsSelect.value);
        let stage = 0;

        if (gameMode === 'tournament') {
            stage = forceStage || 1;
            maxInnings = 3; // トーナメントは3イニング制固定
            
            // ステージごとの難易度割り当て
            if (stage === 1) difficulty = 'easy';
            else if (stage === 2) difficulty = 'medium';
            else if (stage === 3) difficulty = 'hard';
            
            if (forceDifficulty) {
                difficulty = forceDifficulty;
            }
        } else if (gameMode === 'timing_practice') {
            maxInnings = 9;
            difficulty = 'medium';
            this.timingPracticePitches = 0;
            this.timingPracticeErrors = [];
        } else if (gameMode === 'survival_practice') {
            maxInnings = 9;
            difficulty = 'easy';
            this.survivalLives = 3;
            this.survivalStreak = 0;
        }

        try {
            const response = await fetch('/api/game/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ difficulty, maxInnings, gameMode, stage })
            });
            const data = await response.json();
            
            this.state = data.state;
            this.state.practiceMode = false;

            this.dom.lobbyScreen.classList.add('hidden');
            this.dom.gameScreen.classList.remove('hidden');

            this.initHalfInning();
            this.updateUI();

            setTimeout(() => {
                this.dom.battingReadyBtn.focus();
            }, 100);

            let modeAnnounce = "";
            if (gameMode === 'tournament') {
                const stageNames = { 1: "1回戦", 2: "準決勝", 3: "決勝戦" };
                modeAnnounce = `【勝ち抜きトーナメント・${stageNames[stage]}】 `;
            } else if (gameMode === 'timing_practice') {
                modeAnnounce = `【チャレンジ：タイミング測定器】 `;
            } else if (gameMode === 'survival_practice') {
                modeAnnounce = `【チャレンジ：サバイバル見極め】 `;
            }

            this.announce(`${modeAnnounce}試合開始！ 1回表。あなたの攻撃、バッティングです。あなたの今日の調子は【${this.getConditionName(this.state.playerCondition)}】！相手のピッチャーは【${this.state.cpuPitcher.name}】です！ (${this.state.cpuPitcher.desc}) 難易度は ${this.DIFFICULTIES[this.state.difficulty].name} です。`);
            if (this.state.cpuPitcher) {
                synth.playCharacterEntrance(this.state.cpuPitcher);
            }
        } catch (error) {
            console.error("Game start error:", error);
            this.announce("ゲームの開始に失敗しました。サーバーの状態を確認してください。");
        }
    },

    initHalfInning() {
        this.state.isPitchInFlight = false;
        this.state.activePitch = null;

        if (this.state.pitchTimeout) clearTimeout(this.state.pitchTimeout);
        if (this.state.animationFrameId) cancelAnimationFrame(this.state.animationFrameId);

        this.dom.timingCursor.style.left = '0%';
        this.updateUI();
    },

    isTensionState(s) {
        if (!s || !s.runners) return false;
        const runnersCount = s.runners.filter(r => r).length;
        return (runnersCount === 3) || 
               (s.runners[1] || s.runners[2]) || 
               (s.outs === 2 && runnersCount > 0) || 
               (s.balls === 3);
    },

    getConditionName(cond) {
        const names = {
            super_hot: "絶好調",
            hot: "好調",
            normal: "普通",
            cold: "不調"
        };
        return names[cond] || "普通";
    },

    getBatterCondition() {
        return this.state.isBottom ? this.state.cpuBatterCondition : this.state.playerCondition;
    },

    resetGuess() {
        const noneRadio = document.querySelector('input[name="guess-type"][value=""]');
        if (noneRadio) noneRadio.checked = true;
    },

    handlePostActionState(prevInning, prevIsBottom, playMessage) {
        const s = this.state;
        
        // タイミング測定器の終了判定
        if (s.gameMode === 'timing_practice' && this.timingPracticePitches >= 10) {
            this.endTimingPractice();
            return;
        }

        // サバイバル見極めの終了判定
        if (s.gameMode === 'survival_practice' && this.survivalLives <= 0) {
            this.endSurvivalPractice();
            return;
        }

        if (s.currentScreen === 'lobby') {
            this.endGame();
            return;
        }

        if (s.inning !== prevInning || s.isBottom !== prevIsBottom) {
            synth.playThreeOutChange();
            if (!prevIsBottom && s.isBottom) {
                this.initHalfInning();
                this.updateUI();
                const modalMsg = (playMessage ? playMessage + "\n\n" : "") + `${prevInning}回裏、CPUの攻撃（あなたのピッチング）に移ります。`;
                this.showModal("攻守交代", modalMsg, () => {
                    this.dom.pitchThrowBtn.focus();
                    this.announce("あなたのピッチングです。球種とコースを選択し、投球ボタンを押してください。");
                });
                const batter = s.cpuLineup[s.currentCpuBatterIndex];
                if (batter) {
                    synth.playCharacterEntrance(batter);
                }
            } else if (prevIsBottom && !s.isBottom) {
                this.initHalfInning();
                this.updateUI();
                const modalMsg = (playMessage ? playMessage + "\n\n" : "") + `${s.inning}回表、あなたの攻撃（バッティング）に移ります。`;
                
                // ピッチャー交代の判定 (3イニングごと、例：4回、7回などに入るとき)
                let pitcherChangeAnn = "";
                if ((s.inning - 1) % 3 === 0 && s.cpuPitcher) {
                    pitcherChangeAnn = `相手投手は新しく【${s.cpuPitcher.name}】に交代しました！ (${s.cpuPitcher.desc}) `;
                }

                this.showModal(`イニング交代`, modalMsg, () => {
                    this.dom.battingReadyBtn.focus();
                    this.announce(`${s.inning}回表、あなたの攻撃です。${pitcherChangeAnn}エンターキーを押して投球を要求してください。`);
                });

                // 新ピッチャーの登場SEを鳴らす
                if ((s.inning - 1) % 3 === 0 && s.cpuPitcher) {
                    synth.playCharacterEntrance(s.cpuPitcher);
                }
            }
        } else {
            this.focusMainBtn();
        }
    },

    // --------------------------------------------------
    // 【NEW】走塁アニメーション音響のトリガー
    // --------------------------------------------------
    animateRunners(prevRunners, currentRunners, bases, runs, isWalk = false) {
        // バッターの進塁 (0: 本塁)
        if (bases > 0 && !isWalk) {
            this.animateSingleRunner(0, bases);
        } else if (isWalk) {
            // 四球時はゆっくり歩いて1塁へ
            this.animateSingleRunner(0, 1, 1.4);
        }

        // 既存ランナーの進塁
        for (let i = 2; i >= 0; i--) {
            if (prevRunners[i]) {
                const startBase = i + 1; // 1, 2, 3塁
                let endBase = startBase + bases;
                if (isWalk) {
                    // 押し出し判定
                    const force = (i === 0) || 
                                  (i === 1 && prevRunners[0]) || 
                                  (i === 2 && prevRunners[0] && prevRunners[1]);
                    if (force) {
                        endBase = startBase + 1;
                        this.animateSingleRunner(startBase, endBase, 1.4);
                    }
                } else {
                    this.animateSingleRunner(startBase, endBase);
                }
            }
        }
    },

    animateSingleRunner(start, end, durationPerBase = 0.8) {
        let delay = 0;
        for (let base = start; base < end; base++) {
            const currentStart = base;
            const currentEnd = base + 1;
            const currentDelay = delay;
            setTimeout(() => {
                synth.playRunnerProgress(currentStart, currentEnd, durationPerBase);
                if (currentEnd === 4) {
                    // ホームベース到達
                    setTimeout(() => {
                        synth.playHomeIn(1);
                    }, durationPerBase * 1000 - 50);
                }
            }, currentDelay * 1000);
            delay += durationPerBase;
        }
    },

    endGame() {
        this.state.currentScreen = 'lobby';
        let title = "ゲームセット！";
        let winnerMsg = "";
        
        const pScore = this.state.score.player;
        const cScore = this.state.score.cpu;
        const isTournament = this.state.gameMode === 'tournament';
        const stage = this.state.tournamentStage || 0;

        let stats = this.getStats();
        stats.totalGames++;

        const playerWon = pScore > cScore;
        const isDraw = pScore === cScore;

        if (playerWon) {
            winnerMsg = `あなたの勝ち！ スコアは あなた ${pScore} 対 CPU ${cScore} でした！おめでとうございます！`;
            synth.playVictoryJingle();
            synth.boostAmbient(0.12, 6.0);
            setTimeout(() => synth.playCrowdCheer(5.0, 'mega'), 100);
            stats.wins++;
        } else if (cScore > pScore) {
            winnerMsg = `CPUの勝ち！ スコアは あなた ${pScore} 対 CPU ${cScore} でした。次がんばりましょう！`;
            synth.playDefeatSound();
            stats.losses++;
        } else {
            winnerMsg = `引き分け！ スコアは ${pScore} 対 ${cScore} でした。`;
            synth.playSignal('safe');
            stats.draws++;
        }

        this.saveStats(stats);
        this.updateStatsUI();

        if (isTournament) {
            if (playerWon) {
                if (stage === 1) {
                    this.showModal("🏆 1回戦突破！", `スコアは あなた ${pScore} 対 CPU ${cScore}。見事な勝利で1回戦を突破しました！次は準決勝です。準備ができたら決定キーで試合に進みます。`, () => {
                        this.startGame(2);
                    });
                } else if (stage === 2) {
                    this.showModal("🏆 準決勝突破！", `スコアは あなた ${pScore} 対 CPU ${cScore}。強豪を撃破し、ついに決勝戦進出です！準備ができたら決定キーで決勝戦に進みます。`, () => {
                        this.startGame(3);
                    });
                } else if (stage === 3) {
                    stats.tournamentWins = (stats.tournamentWins || 0) + 1;
                    this.saveStats(stats);
                    this.updateStatsUI();
                    
                    this.showModal("👑 トーナメント優勝！！", `おめでとうございます！決勝戦を見事勝利し、勝ち抜きトーナメントの覇者となりました！栄冠を讃えましょう！`, () => {
                        this.shutdownSystem();
                    });
                }
            } else {
                const lossReason = isDraw ? "引き分けのため、トーナメント敗退となります。" : "敗北したため、トーナメント敗退となります。";
                this.showModal("❌ トーナメント敗退", `スコアは あなた ${pScore} 対 CPU ${cScore}。${lossReason}また挑戦しましょう！`, () => {
                    this.shutdownSystem();
                });
            }
        } else {
            this.showModal(title, winnerMsg, () => {
                this.shutdownSystem();
            });
        }
    },

    async shutdownSystem() {
        this.announce("ゲームを終了します。サーバーを停止しています。ご利用ありがとうございました。", "assertive");
        
        document.body.innerHTML = `
            <div style="
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                height: 100vh;
                background: #121212;
                color: #ffffff;
                font-family: 'Outfit', 'Inter', sans-serif;
                text-align: center;
                padding: 20px;
            ">
                <h1 style="color: #ff4757; font-size: 2.5rem; margin-bottom: 20px;">ゲームを終了しました</h1>
                <p style="font-size: 1.2rem; color: #a4b0be; line-height: 1.6;">
                    サーバーを停止しています。<br>
                    このブラウザのタブを閉じて終了してください。
                </p>
                <div style="
                    margin-top: 30px;
                    padding: 10px 20px;
                    background: #2f3542;
                    border-radius: 8px;
                    color: #70a1ff;
                    font-size: 0.9rem;
                ">
                    Thank you for playing!
                </div>
            </div>
        `;
        
        try {
            window.close();
        } catch(e) {}

        setTimeout(async () => {
            try {
                await fetch('/api/game/exit', { method: 'POST' });
            } catch (e) {
                console.error('Failed to call shutdown API', e);
            }
        }, 1500);
    },

    getStats() {
        const defaultStats = {
            totalGames: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            atBats: 0,
            hits: 0,
            homeruns: 0,
            walks: 0,
            tournamentWins: 0,
            bestTimingError: null,
            bestSurvivalStreak: 0
        };
        const statsStr = localStorage.getItem('universal_baseball_stats');
        if (!statsStr) return defaultStats;
        try {
            return { ...defaultStats, ...JSON.parse(statsStr) };
        } catch (e) {
            return defaultStats;
        }
    },

    saveStats(stats) {
        localStorage.setItem('universal_baseball_stats', JSON.stringify(stats));
    },

    trackBattingStats(result) {
        let stats = this.getStats();
        if (result === 'homerun') {
            stats.atBats++;
            stats.hits++;
            stats.homeruns++;
        } else if (result === 'hit') {
            stats.atBats++;
            stats.hits++;
        } else if (result === 'walk') {
            stats.walks++;
        } else if (result === 'out') {
            stats.atBats++;
        } else {
            return;
        }
        this.saveStats(stats);
        this.updateStatsUI();
    },

    updateStatsUI() {
        const stats = this.getStats();
        if (this.dom.statsGames) this.dom.statsGames.textContent = stats.totalGames;
        if (this.dom.statsRecord) {
            this.dom.statsRecord.textContent = `${stats.wins}勝 ${stats.losses}敗 ${stats.draws}分`;
        }
        if (this.dom.statsHr) this.dom.statsHr.textContent = stats.homeruns;
        if (this.dom.statsTournament) {
            this.dom.statsTournament.textContent = stats.tournamentWins || 0;
        }
        if (this.dom.statsBestError) {
            this.dom.statsBestError.textContent = stats.bestTimingError !== null ? `${stats.bestTimingError} ms` : "なし";
        }
        if (this.dom.statsBestSurvival) {
            this.dom.statsBestSurvival.textContent = stats.bestSurvivalStreak || 0;
        }
        if (this.dom.statsAvg) {
            let avg = 0;
            if (stats.atBats > 0) {
                avg = stats.hits / stats.atBats;
            }
            let avgStr = avg.toFixed(3);
            if (avgStr.startsWith('0.')) {
                avgStr = avgStr.substring(1);
            } else if (avgStr === '1.000') {
                avgStr = '1.000';
            }
            this.dom.statsAvg.textContent = avgStr;
        }
    },

    endTimingPractice() {
        this.state.currentScreen = 'lobby';
        
        const errors = this.timingPracticeErrors;
        const total = errors.reduce((sum, e) => sum + e, 0);
        const avg = errors.length > 0 ? Math.round(total / errors.length) : 500;
        
        let rank = "D";
        if (avg < 50) rank = "S";
        else if (avg < 100) rank = "A";
        else if (avg < 150) rank = "B";
        else if (avg < 200) rank = "C";
        
        let stats = this.getStats();
        let isNewRecord = false;
        if (stats.bestTimingError === null || avg < stats.bestTimingError) {
            stats.bestTimingError = avg;
            isNewRecord = true;
            this.saveStats(stats);
            this.updateStatsUI();
        }
        
        const recordMsg = isNewRecord ? "【自己ベスト更新！】" : "";
        const title = "測定終了！";
        const message = `測定結果：10球の平均タイミング誤差は ${avg} ミリ秒でした！\n評価ランク：【${rank}】\n${recordMsg}お疲れ様でした！`;
        
        synth.playVictoryJingle();
        
        this.showModal(title, message, () => {
            this.dom.gameScreen.classList.add('hidden');
            this.dom.lobbyScreen.classList.remove('hidden');
            this.dom.startBtn.focus();
        });
    },

    endSurvivalPractice() {
        this.state.currentScreen = 'lobby';
        
        const streak = this.survivalStreak;
        
        let stats = this.getStats();
        let isNewRecord = false;
        if (streak > (stats.bestSurvivalStreak || 0)) {
            stats.bestSurvivalStreak = streak;
            isNewRecord = true;
            this.saveStats(stats);
            this.updateStatsUI();
        }
        
        const recordMsg = isNewRecord ? "【自己ベスト更新！】" : "";
        const title = "ゲームオーバー！";
        const message = `見極め失敗によりライフがなくなりました。\n記録：${streak} 球連続正解！\n${recordMsg}また挑戦して見極め力を鍛えましょう！`;
        
        synth.playDefeatSound();
        
        this.showModal(title, message, () => {
            this.dom.gameScreen.classList.add('hidden');
            this.dom.lobbyScreen.classList.remove('hidden');
            this.dom.startBtn.focus();
        });
    },

    adjustSurvivalDifficulty() {
        if (this.state.gameMode === 'survival_practice') {
            const streak = this.survivalStreak;
            if (streak >= 15) {
                this.state.cpuPitcher.pitchSpeedMod = 0.70;
            } else if (streak >= 10) {
                this.state.cpuPitcher.pitchSpeedMod = 0.80;
            } else if (streak >= 5) {
                this.state.cpuPitcher.pitchSpeedMod = 0.90;
            }
        }
    },

    updateUI() {
        const s = this.state;
        const d = this.dom;

        // 1. スコアボード
        d.inningDisplay.textContent = `${s.inning}回${s.isBottom ? '裏' : '表'}`;
        
        // イニング得点リスト
        d.playerRunsList.textContent = s.inningRuns.player.map(v => v === '-' ? '-' : v).join(' ');
        d.cpuRunsList.textContent = s.inningRuns.cpu.map(v => v === '-' ? '-' : v).join(' ');
        
        d.playerScore.textContent = s.score.player;
        d.cpuScore.textContent = s.score.cpu;

        // BSOインジケーター点灯
        this.updateIndicators(d.ballIndicators, s.balls, 3);
        this.updateIndicators(d.strikeIndicators, s.strikes, 2);
        this.updateIndicators(d.outIndicators, s.outs, 2);

        // スクリーンリーダー向けBSO音声情報アップデート用のラベル
        d.ballIndicators.setAttribute('aria-label', `ボール ${s.balls}`);
        d.strikeIndicators.setAttribute('aria-label', `ストライク ${s.strikes}`);
        d.outIndicators.setAttribute('aria-label', `アウト ${s.outs}`);

        // 2. ベース状況
        s.runners.forEach((hasRunner, index) => {
            const baseDOM = d[`base${index + 1}`];
            if (hasRunner) {
                baseDOM.classList.add('active');
                baseDOM.setAttribute('aria-label', `${index + 1}塁：ランナーあり`);
            } else {
                baseDOM.classList.remove('active');
                baseDOM.setAttribute('aria-label', `${index + 1}塁：ランナーなし`);
            }
        });

        // 塁全体の読み上げテキスト
        let runnersText = "ランナーなし";
        if (s.runners[0] && s.runners[1] && s.runners[2]) runnersText = "満塁";
        else if (s.runners[0] && s.runners[1]) runnersText = "ランナー1塁・2塁";
        else if (s.runners[0] && s.runners[2]) runnersText = "ランナー1塁・3塁";
        else if (s.runners[1] && s.runners[2]) runnersText = "ランナー2塁・3塁";
        else if (s.runners[0]) runnersText = "ランナー1塁";
        else if (s.runners[1]) runnersText = "ランナー2塁";
        else if (s.runners[2]) runnersText = "ランナー3塁";

        d.runnersStatusText.textContent = runnersText;

        // 3. モード別コントロールの表示切り替え
        if (!s.isBottom) {
            // あなたの攻撃 (バッティング)
            d.currentModeTitle.textContent = "あなたの攻撃 (バッティング)";
            const pName = s.cpuPitcher ? s.cpuPitcher.name : "CPU";
            const pDesc = s.cpuPitcher ? s.cpuPitcher.desc : "";
            d.pitcherInfo.textContent = `投手：${pName} (${pDesc}) ｜ 打者：あなた (調子: ${this.getConditionName(s.playerCondition)}) 難易度: ${this.DIFFICULTIES[s.difficulty].name}`;
            d.battingControls.classList.remove('hidden');
            d.pitchingControls.classList.add('hidden');
            
            // ボタン状態
            if (s.isPitchInFlight) {
                d.battingReadyBtn.disabled = true;
                d.swingBtn.disabled = false;
            } else {
                d.battingReadyBtn.disabled = false;
                d.swingBtn.disabled = true;
            }
        } else {
            // CPUの攻撃 (あなたのピッチング)
            d.currentModeTitle.textContent = "あなたの守備 (ピッチング)";
            const batter = s.cpuLineup[s.currentCpuBatterIndex];
            const bName = batter ? batter.name : "CPU";
            const bDesc = batter ? batter.desc : "";
            d.pitcherInfo.textContent = `打者：${bName} (調子: ${this.getConditionName(s.cpuBatterCondition)}) (${bDesc}) 難易度: ${this.DIFFICULTIES[s.difficulty].name}`;
            d.battingControls.classList.add('hidden');
            d.pitchingControls.classList.remove('hidden');
        }
    },

    updateIndicators(container, activeCount, maxDots) {
        const dots = container.querySelectorAll('.dot');
        dots.forEach((dot, index) => {
            if (index < activeCount) {
                dot.classList.add('active');
            } else {
                dot.classList.remove('active');
            }
        });
    },

    // ==========================================
    // バッティングモード (Userバッター, CPUピッチャー)
    // ==========================================
    
    // 投球を要求 (CPUが投げる準備)
    async prepareForPitch() {
        if (this.state.isPitchInFlight) return;
        
        this.dom.battingReadyBtn.disabled = true;
        const pitcher = this.state.cpuPitcher;
        this.announce(`${pitcher.name}がセットポジションに入りました...`, 'assertive');

        if (this.isTensionState(this.state)) {
            synth.startTensionBgm();
            synth.boostAmbient(0.05, 4.0);
        } else {
            synth.stopTensionBgm();
        }

        const guessRadio = document.querySelector('input[name="guess-type"]:checked');
        const guess = guessRadio ? guessRadio.value : "";

        try {
            const response = await fetch('/api/pitch/prepare', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ guess })
            });
            const data = await response.json();
            
            const windupDelay = pitcher.rushedWindup ? 600 : 1200;

            setTimeout(() => {
                this.throwCPUPitch(data);
            }, windupDelay);
        } catch (error) {
            console.error("Pitch prepare error:", error);
            this.announce("投球の準備に失敗しました。");
            this.dom.battingReadyBtn.disabled = false;
        }
    },

    throwCPUPitch(pitchData) {
        this.state.isPitchInFlight = true;
        this.updateUI();
        
        const pitcher = this.state.cpuPitcher;
        
        const duration = pitchData.duration;
        const minSweet = pitchData.minSweet;
        const maxSweet = pitchData.maxSweet;

        const targetPctMin = (minSweet / duration) * 100;
        const targetPctWidth = ((maxSweet - minSweet) / duration) * 100;
        this.dom.timingTarget.style.left = `${targetPctMin}%`;
        this.dom.timingTarget.style.width = `${targetPctWidth}%`;

        const pitchSound = synth.playPitch(pitchData.pitchType, pitchData.isStrike, duration, pitcher, minSweet, maxSweet);
        
        this.state.activePitch = {
            type: pitchData.pitchType,
            param: {
                name: pitchData.paramName,
                duration: duration,
                minSweet: minSweet,
                maxSweet: maxSweet
            },
            isStrike: pitchData.isStrike,
            sound: pitchSound,
            startTime: pitchSound.startTime,
            pitchText: pitchData.pitchText
        };

        this.dom.swingBtn.disabled = false;
        this.dom.swingBtn.focus();

        if (this.state.practiceMode) {
            this.announce(`${pitchData.paramName}が来ました！`, 'assertive');
        } else {
            this.announce("投げました！", 'assertive');
        }

        this.animateCursor(duration);

        this.state.pitchTimeout = setTimeout(() => {
            this.handleNoSwing();
        }, duration + 200);
    },

    // アニメーション
    animateCursor(duration) {
        const start = performance.now();
        const updateCursor = () => {
            if (!this.state.isPitchInFlight) return;
            
            const elapsed = performance.now() - start;
            const pct = Math.min((elapsed / duration) * 100, 100);
            
            this.dom.timingCursor.style.left = `${pct}%`;
            
            if (pct < 100) {
                this.state.animationFrameId = requestAnimationFrame(updateCursor);
            }
        };
        this.state.animationFrameId = requestAnimationFrame(updateCursor);
    },

    async triggerSwing() {
        if (!this.state.isPitchInFlight || !this.state.activePitch) return;

        // 音声ガイドの進行中スケジュールを停止
        if (this.state.activePitch && this.state.activePitch.sound && this.state.activePitch.sound.guideNodes) {
            this.state.activePitch.sound.guideNodes.forEach(osc => {
                try { osc.stop(); } catch(e) {}
            });
        }

        const swingTime = performance.now();
        const elapsed = swingTime - this.state.activePitch.startTime;

        this.state.isPitchInFlight = false;
        clearTimeout(this.state.pitchTimeout);
        cancelAnimationFrame(this.state.animationFrameId);

        const pitch = this.state.activePitch;
        const pitchText = pitch ? pitch.pitchText : "";
        const p = pitch.param;

        const swingPct = Math.min((elapsed / p.duration) * 100, 100);
        this.dom.timingCursor.style.left = `${swingPct}%`;

        try {
            const response = await fetch('/api/swing', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ elapsed })
            });
            const data = await response.json();
            
            const prevInning = this.state.inning;
            const prevIsBottom = this.state.isBottom;
            const prevScore = { ...this.state.score };
            const prevTension = this.isTensionState(this.state);
            const prevRunners = [...this.state.runners];
            
            this.state = {
                ...this.state,
                ...data.state
            };
            
            this.trackBattingStats(data.result);

            // チャレンジモード集計
            if (this.state.gameMode === 'timing_practice') {
                this.timingPracticePitches++;
                const p = pitch.param;
                const center = (p.minSweet + p.maxSweet) / 2;
                const diff = Math.round(Math.abs(elapsed - center));
                this.timingPracticeErrors.push(diff);
                data.message = `【${this.timingPracticePitches}球目】誤差: ${diff} ミリ秒！ ` + data.message;
            } else if (this.state.gameMode === 'survival_practice') {
                if (pitch.isStrike) {
                    this.survivalStreak++;
                    data.message = `【見極め成功！】ストライクをスイング！連続正解: ${this.survivalStreak}球。 ` + data.message;
                    this.adjustSurvivalDifficulty();
                } else {
                    this.survivalLives--;
                    data.message = `【見極め失敗！】ボール球に手を出してしまいました！残りライフ: ${this.survivalLives}。 ` + data.message;
                }
            }
            
            const runs = this.state.score.player - prevScore.player;
            const hitDir = data.hitDirection || 'center';
            const hitTypeVal = data.hitType || 'single';

            if (data.result === 'homerun') {
                synth.playCrack(1.0, 'homerun', this.getBatterCondition(), hitDir);
                synth.playHomerunFanfare(runs === 4);
                synth.boostAmbient(0.12, 5.0);
                setTimeout(() => synth.playCrowdCheer(4.0, runs === 4 ? 'mega' : 'big'), 100);
            } else if (data.result === 'hit') {
                const center = (p.minSweet + p.maxSweet) / 2;
                const maxDiff = (p.maxSweet - p.minSweet) / 2;
                const accuracy = 1 - (Math.abs(elapsed - center) / maxDiff);
                synth.playCrack(accuracy, hitTypeVal, this.getBatterCondition(), hitDir);
                synth.playSignal('hit');
                synth.boostAmbient(0.08, 3.0);
                setTimeout(() => synth.playCrowdCheer(2.5, data.bases >= 2 ? 'big' : 'medium'), 100);
            } else if (data.result === 'strike' || data.result === 'out') {
                if (data.message.includes("空振り")) {
                    synth.playWoosh(this.getBatterCondition());
                    setTimeout(() => synth.playCatch(), 150);
                } else {
                    synth.playCrack(0.5, hitTypeVal, this.getBatterCondition(), hitDir);
                }
                if (data.message.includes("三振")) {
                    synth.playStrikeout();
                } else if (data.result === 'out') {
                    synth.playSignal('out');
                } else {
                    synth.playSignal('strike');
                }
            } else if (data.result === 'ball' || data.result === 'walk') {
                synth.playCatch();
                if (data.result === 'walk') {
                    synth.playSignal('safe');
                } else {
                    synth.playSignal('ball');
                }
            } else if (data.result === 'foul') {
                const center = (p.minSweet + p.maxSweet) / 2;
                const maxDiff = (p.maxSweet - p.minSweet) / 2;
                const accuracy = 1 - (Math.abs(elapsed - center) / maxDiff);
                synth.playCrack(accuracy * 0.5, 'foul', this.getBatterCondition(), hitDir);
                synth.playSignal('strike');
            }

            if (data.result === 'hit' || data.result === 'walk') {
                this.animateRunners(prevRunners, this.state.runners, data.bases || 1, runs, data.result === 'walk');
            } else if (runs > 0 && data.result !== 'homerun') {
                synth.playHomeIn(runs);
                synth.boostAmbient(0.06, 2.5);
            }

            if (!prevTension && this.isTensionState(this.state)) {
                synth.playPinchWarning();
            }

            this.resetGuess();
            let msg = data.message;
            if (data.result === 'homerun') {
                msg = "ホームラン！ " + msg;
            } else if (data.result === 'hit') {
                msg = "ヒット！ " + msg;
            } else if (data.result === 'out' || data.result === 'out_change') {
                msg = this.getOutPrefix(data.message) + msg;
            } else if (data.result === 'walk') {
                msg = "フォアボール！ " + msg;
            }
            if (pitchText) {
                msg = msg + " " + pitchText;
            }
            this.announce(msg);
            this.updateUI();

            this.handlePostActionState(prevInning, prevIsBottom, msg);
        } catch (error) {
            console.error("Swing processing error:", error);
            this.announce("スイングの判定に失敗しました。");
        }
    },

    async handleNoSwing() {
        const pitch = this.state.activePitch;
        const pitchText = pitch ? pitch.pitchText : "";
        // 音声ガイドの進行中スケジュールを停止
        if (this.state.activePitch && this.state.activePitch.sound && this.state.activePitch.sound.guideNodes) {
            this.state.activePitch.sound.guideNodes.forEach(osc => {
                try { osc.stop(); } catch(e) {}
            });
        }

        this.state.isPitchInFlight = false;
        cancelAnimationFrame(this.state.animationFrameId);
        
        try {
            const response = await fetch('/api/take', { method: 'POST' });
            const data = await response.json();
            
            const prevInning = this.state.inning;
            const prevIsBottom = this.state.isBottom;
            const prevScore = { ...this.state.score };
            const prevTension = this.isTensionState(this.state);
            
            this.state = {
                ...this.state,
                ...data.state
            };

            this.trackBattingStats(data.result);

            // チャレンジモード集計
            if (this.state.gameMode === 'timing_practice') {
                this.timingPracticePitches++;
                this.timingPracticeErrors.push(500);
                data.message = `【${this.timingPracticePitches}球目】見逃し（誤差500ミリ秒としてカウント）。 ` + data.message;
            } else if (this.state.gameMode === 'survival_practice' && pitch) {
                if (!pitch.isStrike) {
                    this.survivalStreak++;
                    data.message = `【見極め成功！】ボールを見送りました！連続正解: ${this.survivalStreak}球。 ` + data.message;
                    this.adjustSurvivalDifficulty();
                } else {
                    this.survivalLives--;
                    data.message = `【見極め失敗！】ストライクを見逃しました！残りライフ: ${this.survivalLives}。 ` + data.message;
                }
            }

            synth.playCatch();
            if (data.result === 'strike' || data.result === 'out') {
                if (data.message.includes("三振")) {
                    synth.playStrikeout();
                } else if (data.result === 'out') {
                    synth.playSignal('out');
                } else {
                    synth.playSignal('strike');
                }
            } else if (data.result === 'ball' || data.result === 'walk') {
                if (data.result === 'walk') {
                    synth.playSignal('safe');
                } else {
                    synth.playSignal('ball');
                }
            }

            const runs = this.state.score.player - prevScore.player;
            if (runs > 0) {
                synth.playHomeIn(runs);
                synth.boostAmbient(0.06, 2.5);
            }

            if (!prevTension && this.isTensionState(this.state)) {
                synth.playPinchWarning();
            }

            this.resetGuess();
            let msg = data.message;
            if (data.result === 'homerun') {
                msg = "ホームラン！ " + msg;
            } else if (data.result === 'hit') {
                msg = "ヒット！ " + msg;
            } else if (data.result === 'out' || data.result === 'out_change') {
                msg = this.getOutPrefix(data.message) + msg;
            } else if (data.result === 'walk') {
                msg = "フォアボール！ " + msg;
            }
            if (pitchText) {
                msg = msg + " " + pitchText;
            }
            this.announce(msg);
            this.updateUI();

            this.handlePostActionState(prevInning, prevIsBottom, msg);
        } catch (error) {
            console.error("Take processing error:", error);
            this.announce("見逃し判定に失敗しました。");
        }
    },

    // ダミー
    dummyBattingPlaceHolder() {
    },

    /* prepareForPitch() {
        if (this.state.isPitchInFlight) return;
        
        this.dom.battingReadyBtn.disabled = true;
        const pitcher = this.state.cpuPitcher;
        this.announce(`${pitcher.name}がセットポジションに入りました...`, 'assertive');

        // ピッチャーの投球ロジック
        const diff = this.DIFFICULTIES[this.state.difficulty];
        
        // 基本のストライク率をキャラクター特性で補正
        let sRate = pitcher.strikeRate !== undefined ? pitcher.strikeRate : diff.strikeRate;
        // 難易度調整
        if (this.state.difficulty === 'easy') sRate = Math.min(sRate + 0.15, 0.85);
        if (this.state.difficulty === 'hard') sRate = Math.max(sRate - 0.15, 0.35);

        const isStrike = Math.random() < sRate;

        // 球種の決定
        const pitchKeys = Object.keys(this.PITCH_TYPES);
        let pitchType = pitchKeys[Math.floor(Math.random() * pitchKeys.length)];
        
        // キャラクター固有の球種傾向
        if (pitcher.lowPitchesOnly) {
            // マイナス星人は低めの変化球・チェンジアップ多め
            pitchType = Math.random() < 0.7 ? 'changeup' : 'curve';
        } else if (pitcher.sawNoise || pitcher.rageMode || pitcher.spendAll) {
            // 豪速球タイプはストレート多め
            pitchType = Math.random() < 0.7 ? 'fastball' : pitchType;
        } else if (pitcher.annoyingChangeup) {
            pitchType = 'changeup';
        }

        const pitchParam = this.PITCH_TYPES[pitchType];

        // 腹減り星人はせっかちなので、準備時間が短い
        const windupDelay = pitcher.rushedWindup ? 600 : 1200;

        setTimeout(() => {
            this.throwCPUPitch(pitchType, pitchParam, isStrike);
        }, windupDelay);
    },

    throwCPUPitch(pitchType, param, isStrike) {
        this.state.isPitchInFlight = true;
        this.updateUI();
        
        const pitcher = this.state.cpuPitcher;
        
        // 速度補正の適用
        const speedMod = pitcher.pitchSpeedMod || 1.0;
        const duration = param.duration * speedMod;
        const minSweet = param.minSweet * speedMod;
        const maxSweet = param.maxSweet * speedMod;

        // ビジュアル用スイープ表示準備
        const targetPctMin = (minSweet / duration) * 100;
        const targetPctWidth = ((maxSweet - minSweet) / duration) * 100;
        this.dom.timingTarget.style.left = `${targetPctMin}%`;
        this.dom.timingTarget.style.width = `${targetPctWidth}%`;

        // 投球サウンド開始
        const pitchSound = synth.playPitch(pitchType, isStrike, duration, pitcher);
        
        // 速度調整されたパラメータでactivePitchを記録
        this.state.activePitch = {
            type: pitchType,
            param: {
                name: param.name,
                duration: duration,
                minSweet: minSweet,
                maxSweet: maxSweet
            },
            isStrike: isStrike,
            sound: pitchSound,
            startTime: pitchSound.startTime
        };

        // スイングボタンの有効化とフォーカス
        this.dom.swingBtn.disabled = false;
        this.dom.swingBtn.focus();

        if (this.state.practiceMode) {
            this.announce(`${param.name}が来ました！`, 'assertive');
        } else {
            const throwText = pitcher.pitchText || `${pitcher.name}が投げました！`;
            this.announce(throwText, 'assertive');
        }

        // ビジュアルタイミングのアニメーションループ
        this.animateCursor(duration);

        // 打者がスイングしなかった場合のタイムアウト処理
        this.state.pitchTimeout = setTimeout(() => {
            this.handleNoSwing();
        }, duration + 200);
    },

    // 視覚的メーターのアニメーション
    animateCursor(duration) {
        const start = performance.now();
        const updateCursor = () => {
            if (!this.state.isPitchInFlight) return;
            
            const elapsed = performance.now() - start;
            const pct = Math.min((elapsed / duration) * 100, 100);
            
            this.dom.timingCursor.style.left = `${pct}%`;
            
            if (pct < 100) {
                this.state.animationFrameId = requestAnimationFrame(updateCursor);
            }
        };
        this.state.animationFrameId = requestAnimationFrame(updateCursor);
    },

    // スイング操作 (Space / ボタンクリック)
    triggerSwing() {
        if (!this.state.isPitchInFlight || !this.state.activePitch) return;

        // タイミング算出
        const swingTime = performance.now();
        const elapsed = swingTime - this.state.activePitch.startTime;

        // 状態リセット
        this.state.isPitchInFlight = false;
        clearTimeout(this.state.pitchTimeout);
        cancelAnimationFrame(this.state.animationFrameId);

        const pitch = this.state.activePitch;
        const p = pitch.param;

        // 視覚的なスイング            setTimeout(() => {
                this.state.isPitchInFlight = false;
                
                const prevInning = this.state.inning;
                const prevIsBottom = this.state.isBottom;
                const prevScore = { ...this.state.score };
                const prevBatterIndex = this.state.currentCpuBatterIndex;
                const prevTension = this.isTensionState(this.state);
                const prevRunners = [...this.state.runners];

                this.state = {
                    ...this.state,
                    ...data.state
                };

                const runs = this.state.score.cpu - prevScore.cpu;
                const hitDir = data.hitDirection || 'center';
                const hitTypeVal = data.hitType || 'single';

                if (data.cpuSwings) {
                    if (data.cpuMisses) {
                        synth.playWoosh(this.getBatterCondition());
                        setTimeout(() => synth.playCatch(), 120);
                        if (data.message.includes("三振")) {
                            synth.playStrikeout();
                        } else {
                            synth.playSignal('strike');
                        }
                    } else {
                        const contactPower = (batter.rageMode || batter.heavyL || batter.spendAll) ? 0.95 : 0.7;

                        if (data.result === 'homerun') {
                            synth.playCrack(1.0, 'homerun', this.getBatterCondition(), hitDir);
                            synth.playHomerunFanfare(false);
                            synth.boostAmbient(0.08, 4.0);
                            setTimeout(() => synth.playCrowdCheer(4.0, 'big'), 100);
                        } else if (data.result === 'hit') {
                            synth.playCrack(contactPower, hitTypeVal, this.getBatterCondition(), hitDir);
                            synth.playSignal('hit');
                            synth.boostAmbient(0.06, 2.5);
                            setTimeout(() => synth.playCrowdCheer(2.5, data.bases >= 2 ? 'big' : 'medium'), 100);
                        } else if (data.result === 'foul') {
                            synth.playCrack(contactPower * 0.6, 'foul', this.getBatterCondition(), hitDir);
                            synth.playSignal('strike');
                        } else if (data.result === 'out') {
                            synth.playCrack(contactPower * 0.6, hitTypeVal, this.getBatterCondition(), hitDir);
                            if (data.message.includes("三振")) {
                                synth.playStrikeout();
                            } else {
                                synth.playSignal('out');
                            }
                        }
                    }
                } else {
                    synth.playCatch();
                    if (data.result === 'strike' || (data.message.includes("ストライク") && data.result === 'out')) {
                        if (data.message.includes("三振")) {
                            synth.playStrikeout();
                        } else {
                            synth.playSignal('strike');
                        }
                    } else {
                        if (data.result === 'walk') {
                            synth.playSignal('safe');
                        } else {
                            synth.playSignal('ball');
                        }
                    }
                }

                if (data.result === 'hit' || data.result === 'walk') {
                    this.animateRunners(prevRunners, this.state.runners, data.bases || 1, runs, data.result === 'walk');
                } else if (runs > 0 && data.result !== 'homerun') {
                    synth.playHomeIn(runs);
                    synth.boostAmbient(0.06, 2.5);
                }ャーフライでアウト！",
                    "ボテボテの当たり、ファーストゴロでアウト！",
                    "鋭いあたりもショート正面、ライナーでアウト！"
                ];
                const type = outTypes[Math.floor(Math.random() * outTypes.length)];
                this.processOut(type);
            }
        }
    }, */


    // ==========================================
    // ピッチングモード (Userピッチャー, CPUバッター)
    // ==========================================
    
    async triggerPitch() {
        if (this.state.isPitchInFlight) return;

        const pitchType = document.querySelector('input[name="pitch-type"]:checked').value;
        const pitchLoc = document.querySelector('input[name="pitch-loc"]:checked').value;
        const pitchSpeed = this.state.userPitchSpeed;
        
        const isStrike = (pitchLoc === 'strike-center');
        const param = this.PITCH_TYPES[pitchType];

        this.state.isPitchInFlight = true;
        this.updateUI();

        const speedMod = pitchSpeed === 'fast' ? 0.7 : (pitchSpeed === 'slow' ? 1.45 : 1.0);
        const duration = param.duration * speedMod;
        const minSweet = param.minSweet * speedMod;
        const maxSweet = param.maxSweet * speedMod;

        const batter = this.state.cpuLineup[this.state.currentCpuBatterIndex];
        
        if (this.isTensionState(this.state)) {
            synth.startTensionBgm();
            synth.boostAmbient(0.05, 4.0);
        } else {
            synth.stopTensionBgm();
        }

        synth.playPitch(pitchType, isStrike, duration);

        try {
            const response = await fetch('/api/pitch/throw', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pitchType, pitchLoc, pitchSpeed })
            });
            const data = await response.json();

            const swingCheckDelay = minSweet + Math.random() * (maxSweet - minSweet);

            setTimeout(() => {
                this.state.isPitchInFlight = false;
                
                const prevInning = this.state.inning;
                const prevIsBottom = this.state.isBottom;
                const prevScore = { ...this.state.score };
                const prevBatterIndex = this.state.currentCpuBatterIndex;
                const prevTension = this.isTensionState(this.state);
                const prevRunners = [...this.state.runners];

                this.state = {
                    ...this.state,
                    ...data.state
                };

                const runs = this.state.score.cpu - prevScore.cpu;
                const hitDir = data.hitDirection || 'center';
                const hitTypeVal = data.hitType || 'single';

                if (data.cpuSwings) {
                    if (data.cpuMisses) {
                        synth.playWoosh(this.getBatterCondition());
                        setTimeout(() => synth.playCatch(), 120);
                        if (data.message.includes("三振")) {
                            synth.playStrikeout();
                        } else {
                            synth.playSignal('strike');
                        }
                    } else {
                        const contactPower = (batter.rageMode || batter.heavyL || batter.spendAll) ? 0.95 : 0.7;

                        if (data.result === 'homerun') {
                            synth.playCrack(1.0, 'homerun', this.getBatterCondition(), hitDir);
                            synth.playHomerunFanfare(false);
                            synth.boostAmbient(0.08, 4.0);
                            setTimeout(() => synth.playCrowdCheer(4.0, 'big'), 100);
                        } else if (data.result === 'hit') {
                            synth.playCrack(contactPower, hitTypeVal, this.getBatterCondition(), hitDir);
                            synth.playSignal('hit');
                            synth.boostAmbient(0.06, 2.5);
                            setTimeout(() => synth.playCrowdCheer(2.5, data.bases >= 2 ? 'big' : 'medium'), 100);
                        } else if (data.result === 'foul') {
                            synth.playCrack(contactPower * 0.6, 'foul', this.getBatterCondition(), hitDir);
                            synth.playSignal('strike');
                        } else if (data.result === 'out') {
                            synth.playCrack(contactPower * 0.6, hitTypeVal, this.getBatterCondition(), hitDir);
                            if (data.message.includes("三振")) {
                                synth.playStrikeout();
                            } else {
                                synth.playSignal('out');
                            }
                        }
                    }
                } else {
                    synth.playCatch();
                    if (data.result === 'strike' || (data.message.includes("ストライク") && data.result === 'out')) {
                        if (data.message.includes("三振")) {
                            synth.playStrikeout();
                        } else {
                            synth.playSignal('strike');
                        }
                    } else {
                        if (data.result === 'walk') {
                            synth.playSignal('safe');
                        } else {
                            synth.playSignal('ball');
                        }
                    }
                }

                if (data.result === 'hit' || data.result === 'walk') {
                    this.animateRunners(prevRunners, this.state.runners, data.bases || 1, runs, data.result === 'walk');
                } else if (runs > 0 && data.result !== 'homerun') {
                    synth.playHomeIn(runs);
                    synth.boostAmbient(0.06, 2.5);
                }

                if (this.state.isBottom && this.state.currentCpuBatterIndex !== prevBatterIndex) {
                    const nextBatter = this.state.cpuLineup[this.state.currentCpuBatterIndex];
                    if (nextBatter) {
                        synth.playCharacterEntrance(nextBatter);
                    }
                }

                if (!prevTension && this.isTensionState(this.state)) {
                    synth.playPinchWarning();
                }

                const throwInfo = `あなたが${batter.name}に対して、球速「${this.getSpeedName(pitchSpeed)}」で投げました！`;
                let msg = data.message;
                if (data.result === 'homerun') {
                    msg = "ホームラン！ " + msg + " " + throwInfo;
                } else if (data.result === 'hit') {
                    msg = "ヒット！ " + msg + " " + throwInfo;
                } else if (data.result === 'out' || data.result === 'out_change') {
                    msg = this.getOutPrefix(data.message) + msg + " " + throwInfo;
                } else if (data.result === 'walk') {
                    msg = "フォアボール！ " + msg + " " + throwInfo;
                } else if (data.result === 'strike') {
                    msg = "ストライク！ " + msg + " " + throwInfo;
                } else if (data.result === 'ball') {
                    msg = "ボール！ " + msg + " " + throwInfo;
                } else if (data.result === 'foul') {
                    msg = "ファウル！ " + msg + " " + throwInfo;
                } else {
                    msg = msg + " " + throwInfo;
                }
                this.announce(msg);
                this.updateUI();

                this.handlePostActionState(prevInning, prevIsBottom, msg);
            }, swingCheckDelay);

        } catch (error) {
            console.error("Pitch throw error:", error);
            this.announce("投球の処理に失敗しました。");
            this.state.isPitchInFlight = false;
            this.updateUI();
        }
    },

    // ダミー
    dummyPitchingPlaceHolder() {
    },

    /* triggerPitch() {
        if (this.state.isPitchInFlight) return;

        // 選択された球種とコースを取得
        const pitchType = document.querySelector('input[name="pitch-type"]:checked').value;
        const pitchLoc = document.querySelector('input[name="pitch-loc"]:checked').value;
        
        const isStrike = (pitchLoc === 'strike-center');
        const param = this.PITCH_TYPES[pitchType];

        this.state.isPitchInFlight = true;
        this.updateUI();

        // 投球スピード補正
        const speedMod = this.state.userPitchSpeed === 'fast' ? 0.7 : (this.state.userPitchSpeed === 'slow' ? 1.45 : 1.0);
        const duration = param.duration * speedMod;
        const minSweet = param.minSweet * speedMod;
        const maxSweet = param.maxSweet * speedMod;

        const batter = this.state.cpuLineup[this.state.currentCpuBatterIndex];
        this.announce("投げました！", 'assertive');
        
        // 投球音を鳴らす (ユーザーの球。スピード指定に応じた時間にする)
        synth.playPitch(pitchType, isStrike, duration);

        // スイング判断のタイミング (球種のスイープの終わり頃)
        const swingCheckDelay = minSweet + Math.random() * (maxSweet - minSweet);

        setTimeout(() => {
            this.cpuDecision(pitchType, isStrike, { duration, minSweet, maxSweet });
        }, swingCheckDelay);
    },

    // CPUの打撃判定
    cpuDecision(pitchType, isStrike, param) {
        this.state.isPitchInFlight = false;
        
        const diff = this.DIFFICULTIES[this.state.difficulty];
        const batter = this.state.cpuLineup[this.state.currentCpuBatterIndex];
        
        // キャラクター特性に応じたスイング確率の設定
        let swingChance = isStrike ? batter.swingAtStrike : batter.swingAtBall;
        
        // 難易度によるスイング確率の補正
        if (this.state.difficulty === 'easy') {
            if (!isStrike) swingChance = Math.min(swingChance + 0.15, 0.85); // ボールをよく振る
            if (isStrike) swingChance = Math.max(swingChance - 0.15, 0.40);
        } else if (this.state.difficulty === 'hard') {
            if (!isStrike) swingChance = Math.max(swingChance - 0.10, 0.02); // ボールを全く振らない
            if (isStrike) swingChance = Math.min(swingChance + 0.10, 0.98);
        }
        
        // 追い込まれている場合
        if (this.state.strikes === 2 && isStrike) {
            swingChance = Math.min(swingChance + 0.15, 0.98);
        }

        const cpuSwings = Math.random() < swingChance;

        if (cpuSwings) {
            // スイングした場合：当たるか空振りか
            let missChance = batter.cpuMissRate;
            
            // 難易度によるミスカット補正
            if (this.state.difficulty === 'easy') missChance = Math.min(missChance + 0.15, 0.80);
            if (this.state.difficulty === 'hard') missChance = Math.max(missChance - 0.08, 0.01);

            // ボール球を振らせた場合、空振りが大幅アップ
            if (!isStrike) {
                missChance = Math.min(missChance * 3, 0.95);
            }

            const cpuMisses = Math.random() < missChance;

            if (cpuMisses) {
                // 空振り
                synth.playWoosh();
                setTimeout(() => synth.playCatch(), 120);
                
                let strMsg = `${batter.name}は空振りしました！ストライク！`;
                if (batter.grumbleM) {
                    strMsg = `「なにすんねん！」と怒りながら${batter.name}が空振り！ストライク！`;
                } else if (batter.cryBaby) {
                    strMsg = `「ふえぇん！」と泣きそうな顔で${batter.name}が空振り！ストライク！`;
                }
                this.processStrike(strMsg);
            } else {
                // バットに当たった：ヒットかアウトか
                // 強打者（大暴れ、お金、怖いLなど）は良い当たりが出やすい
                const contactPower = (batter.rageMode || batter.heavyL || batter.spendAll) ? 0.95 : 0.7;
                synth.playCrack(contactPower);
                
                // ヒット確率
                let hitChance = 0.35;
                if (this.state.difficulty === 'easy') hitChance = 0.22;
                if (this.state.difficulty === 'hard') hitChance = 0.48;
                
                // 強打者補正
                if (batter.rageMode || batter.heavyL) hitChance += 0.12;
                // マイナス星人、アマエンボ星人はヒット確率低下
                if (batter.lowPitchesOnly || batter.cryBaby) hitChance -= 0.10;
                // ボール球を打たせた場合はヒット確率低下
                if (!isStrike) hitChance *= 0.35;

                const isHit = Math.random() < hitChance;

                if (isHit) {
                    setTimeout(() => synth.playCrowdCheer(2.5), 100);
                    
                    const rand = Math.random();
                    let hitBases = 1;
                    let hitMsg = "";

                    // 強打者や甘い球は長打になりやすい
                    const isExtraBase = (rand < 0.35) || (isStrike && batter.sweetZone);

                    if (isExtraBase) {
                        if (rand < 0.15 || (batter.heavyL && rand < 0.4)) {
                            hitBases = 4; // ホームラン
                        } else if (rand < 0.6) {
                            hitBases = 2; // 2塁打
                            hitMsg = `${batter.name}に左中間を破るツーベースヒットを浴びました！`;
                        } else {
                            hitBases = 3; // 3塁打
                            hitMsg = `${batter.name}にレフト線を破るスリーベースヒットを浴びました！`;
                        }
                    } else {
                        hitBases = 1; // シングル
                        hitMsg = `${batter.name}にヒットを打たれました！`;
                    }

                    // バターの固有テキスト結合
                    const flavor = batter.flavorText || "鋭い打球が飛んだ！";

                    if (hitBases === 4) {
                        this.processHomerun();
                    } else {
                        this.processBaseHit(hitBases, `${batter.name}の打撃：${flavor} ${hitMsg}`);
                    }
                } else {
                    // 凡打アウトまたはファウル
                    if (Math.random() < 0.4) {
                        this.processFoul(`${batter.name}はファウルボールを打ちました。`);
                    } else {
                        const outTypes = [
                            `${batter.name}はショートゴロ！アウト！`,
                            `${batter.name}は力んでセンターフライ！アウト！`,
                            `${batter.name}はサードゴロ！アウト！`,
                            `${batter.name}はピッチャーゴロに倒れました！アウト！`
                        ];
                        let outMsg = outTypes[Math.floor(Math.random() * outTypes.length)];
                        this.processOut(outMsg);
                    }
                }
            }
        } else {
            // 見送った場合
            synth.playCatch();
            if (isStrike) {
                let strikeText = `${batter.name}は見送りました。ストライク！`;
                if (batter.heavySleep) {
                    strikeText = `${batter.name}はお布団星人のアホみたいに太いベルトで縛られたかのように身動きせず、見送りストライク！`;
                }
                this.processStrike(strikeText);
            } else {
                this.processBall(`${batter.name}は見送りました。ボール。`);
            }
        }
    },


    // ==========================================
    // 判定処理共通メソッド (得点、アウト等)
    // ==========================================

    processStrike(message) {
        this.state.strikes++;
        synth.playSignal('strike');
        
        if (this.state.strikes >= 3) {
            this.announce(message);
            const batter = this.state.cpuLineup[this.state.currentCpuBatterIndex];
            let outMsg = "バッター三振！アウト！";
            if (this.state.isBottom && batter) {
                if (batter.id === 'kowai_l') {
                    outMsg = "怖い星人（Lサイズ）は「タッチすんなぁ！」と怒り叫び、あなた（投手）を「たかいたかーい」と抱え上げてからベンチに戻りました！三振アウト！";
                } else if (batter.cryBaby) {
                    outMsg = "アマエンボ星人は「ふえぇん！」と大泣きしながらベンチに戻っていきました。三振アウト！";
                } else if (batter.heavySleep) {
                    outMsg = "お布団星人はお布団のぬくもりから起き上がれないようベルトで縛られたまま、見送り三振アウト！";
                } else if (batter.id === 'fukufuku') {
                    outMsg = "服服星人は脱いだ服を探すのに夢中でバットを振るのを忘れました！三振アウト！";
                }
            }
            this.processOut(outMsg);
        } else {
            this.announce(`${message} カウントは${this.state.balls}ボール、${this.state.strikes}ストライク。`);
            this.updateUI();
            this.focusMainBtn();
        }
    },

    processBall(message) {
        this.state.balls++;
        synth.playSignal('ball');

        if (this.state.balls >= 4) {
            this.announce(message);
            this.processWalk();
        } else {
            this.announce(`${message} カウントは${this.state.balls}ボール、${this.state.strikes}ストライク。`);
            this.updateUI();
            this.focusMainBtn();
        }
    },

    processFoul(message) {
        // ファウルは2ストライクまではストライクカウントが増える
        if (this.state.strikes < 2) {
            this.state.strikes++;
            synth.playSignal('strike');
        }
        this.announce(`${message} カウントは${this.state.balls}ボール、${this.state.strikes}ストライク。`);
        this.updateUI();
        this.focusMainBtn();
    },

    processOut(message) {
        this.state.outs++;
        this.state.balls = 0;
        this.state.strikes = 0;
        synth.playSignal('out');

        if (this.state.outs >= 3) {
            this.announce(`${message} 3アウトチェンジ！`);
            this.recordInningRuns();
            this.switchHalfInning();
        } else {
            let nextBatterAnnouncement = "";
            if (this.state.isBottom) {
                // 打者の交代
                this.state.currentCpuBatterIndex = (this.state.currentCpuBatterIndex + 1) % this.state.cpuLineup.length;
                const nextBatter = this.state.cpuLineup[this.state.currentCpuBatterIndex];
                nextBatterAnnouncement = ` 次の打者は、${nextBatter.name} です。`;
            }
            this.announce(`${message} ワンアウト追加。これで${this.state.outs}アウト。${nextBatterAnnouncement}`);
            this.updateUI();
            this.focusMainBtn();
        }
    },

    // ヒットのランナー進塁処理
    processBaseHit(bases, message) {
        synth.playSignal('hit');
        
        let runsScored = 0;
        const newRunners = [false, false, false];

        // 既存のランナーを進塁させる (後ろの塁から処理)
        for (let i = 2; i >= 0; i--) {
            if (this.state.runners[i]) {
                const newPos = i + bases;
                if (newPos >= 3) {
                    runsScored++; // 本塁帰還
                } else {
                    newRunners[newPos] = true;
                }
            }
        }

        // バッターを進塁させる
        if (bases >= 4) {
            runsScored++;
        } else {
            newRunners[bases - 1] = true;
        }

        this.state.runners = newRunners;
        this.state.balls = 0;
        this.state.strikes = 0;

        let resultMsg = message;
        if (runsScored > 0) {
            this.addScore(runsScored);
            resultMsg += ` ランナーが ${runsScored} 人ホームイン！ ${runsScored}点獲得。`;
        }

        let nextBatterAnnouncement = "";
        if (this.state.isBottom) {
            // 打者の交代
            this.state.currentCpuBatterIndex = (this.state.currentCpuBatterIndex + 1) % this.state.cpuLineup.length;
            const nextBatter = this.state.cpuLineup[this.state.currentCpuBatterIndex];
            nextBatterAnnouncement = ` 次の打者は、${nextBatter.name} です。`;
        }

        this.announce(resultMsg + nextBatterAnnouncement);
        this.updateUI();
        this.focusMainBtn();
    },

    // ホームラン
    processHomerun() {
        synth.playHomerunFanfare();
        setTimeout(() => synth.playCrowdCheer(4.0), 100);

        let runsScored = 1; // バッター分
        this.state.runners.forEach(r => {
            if (r) runsScored++;
        });

        this.state.runners = [false, false, false];
        this.state.balls = 0;
        this.state.strikes = 0;

        this.addScore(runsScored);
        
        let msg = "打ったー！これは大きい！ぐんぐん伸びてスタンドに突き刺さった！ホームラン！！";
        if (runsScored === 4) {
            msg = "打ったー！大きい！なんと満塁ホームラン！！グランドスラムだ！";
        }
        
        const batter = this.state.cpuLineup[this.state.currentCpuBatterIndex];
        if (this.state.isBottom && batter) {
            msg = `${batter.name}の打撃：${batter.flavorText || "強烈な一撃！"} ${msg}`;
        }
        
        let nextBatterAnnouncement = "";
        if (this.state.isBottom) {
            // 打者の交代
            this.state.currentCpuBatterIndex = (this.state.currentCpuBatterIndex + 1) % this.state.cpuLineup.length;
            const nextBatter = this.state.cpuLineup[this.state.currentCpuBatterIndex];
            nextBatterAnnouncement = ` 次の打者は、${nextBatter.name} です。`;
        }

        this.announce(`${msg} 一挙に ${runsScored} 点追加！${nextBatterAnnouncement}`);
        this.updateUI();
        this.focusMainBtn();
    },

    // 四球 (フォアボール)
    processWalk() {
        synth.playSignal('safe');
        
        let runsScored = 0;
        const newRunners = [...this.state.runners];

        // フォアボールによるランナー強制押し出し進塁
        if (!newRunners[0]) {
            newRunners[0] = true; // 1塁へ
        } else if (!newRunners[1]) {
            newRunners[1] = true; // 1塁にいたので2塁も埋まる
        } else if (!newRunners[2]) {
            newRunners[2] = true; // 満塁になる
        } else {
            // 満塁押し出し
            runsScored = 1;
        }

        this.state.runners = newRunners;
        this.state.balls = 0;
        this.state.strikes = 0;

        let msg = "フォアボール！押し出しです。";
        const batter = this.state.cpuLineup[this.state.currentCpuBatterIndex];
        if (this.state.isBottom && batter) {
            msg = `${batter.name}はフォアボールを選びました。押し出しです。`;
        }
        
        if (runsScored > 0) {
            this.addScore(runsScored);
            msg += " 1点入りました！";
        } else {
            msg += " ランナーがそれぞれ進塁します。";
        }

        let nextBatterAnnouncement = "";
        if (this.state.isBottom) {
            // 打者の交代
            this.state.currentCpuBatterIndex = (this.state.currentCpuBatterIndex + 1) % this.state.cpuLineup.length;
            const nextBatter = this.state.cpuLineup[this.state.currentCpuBatterIndex];
            nextBatterAnnouncement = ` 次の打者は、${nextBatter.name} です。`;
        }

        this.announce(msg + nextBatterAnnouncement);
        this.updateUI();
        this.focusMainBtn();
    },

    // スコア加算
    addScore(runs) {
        if (!this.state.isBottom) {
            this.state.score.player += runs;
        } else {
            this.state.score.cpu += runs;
        }
    },

    // イニング終了時の得点を配列に記録
    recordInningRuns() {
        const idx = this.state.inning - 1;
        
        // 今回のイニングで獲得した得点数を計算
        const currentTotal = !this.state.isBottom ? this.state.score.player : this.state.score.cpu;
        
        // 前の回までの合計を引く
        const runsList = !this.state.isBottom ? this.state.inningRuns.player : this.state.inningRuns.cpu;
        
        let previousTotal = 0;
        for (let i = 0; i < idx; i++) {
            if (runsList[i] !== '-') previousTotal += runsList[i];
        }

        runsList[idx] = currentTotal - previousTotal;
    }, */

    // ==========================================
    // 練習モード
    // ==========================================
    togglePracticeMode() {
        this.state.practiceMode = !this.state.practiceMode;
        if (this.state.practiceMode) {
            this.dom.btnPracticePitch.classList.add('btn-primary');
            this.dom.btnPracticePitch.classList.remove('btn-secondary');
            this.dom.btnPracticePitch.textContent = "練習モードオン";
            this.announce("タイミング練習モードをオンにしました。球種のタイミングが声でガイドされます。");
        } else {
            this.dom.btnPracticePitch.classList.remove('btn-primary');
            this.dom.btnPracticePitch.classList.add('btn-secondary');
            this.dom.btnPracticePitch.textContent = "球種タイミング練習";
            this.announce("練習モードをオフにしました。");
        }
        
        // バッティングフォーカスに戻す
        this.focusMainBtn();
    },

    // ==========================================
    // フォーカスヘルパー
    // ==========================================
    
    // アクション後に適切なメイン操作ボタンにフォーカスを戻す
    focusMainBtn() {
        setTimeout(() => {
            if (!this.state.isBottom) {
                if (this.state.isPitchInFlight) {
                    this.dom.swingBtn.focus();
                } else {
                    this.dom.battingReadyBtn.focus();
                }
            } else {
                this.dom.pitchThrowBtn.focus();
            }
        }, 100);
    },

    adjustPitchSpeed(direction) {
        const speeds = ['slow', 'normal', 'fast'];
        let index = speeds.indexOf(this.state.userPitchSpeed);
        index += direction;
        if (index >= 0 && index < speeds.length) {
            this.state.userPitchSpeed = speeds[index];
            const radio = document.querySelector(`input[name="pitch-speed"][value="${this.state.userPitchSpeed}"]`);
            if (radio) radio.checked = true;
            this.announce(`球速を「${this.getSpeedName(this.state.userPitchSpeed)}」に変更しました。`, 'polite');
        }
    },

    getSpeedName(speedVal) {
        const names = { slow: "おそい", normal: "ふつう", fast: "はやい" };
        return names[speedVal] || "ふつう";
    },

    readGameStatus() {
        const s = this.state;
        const runners = [];
        if (s.runners[0]) runners.push("1塁");
        if (s.runners[1]) runners.push("2塁");
        if (s.runners[2]) runners.push("3塁");
        const runnersText = runners.length > 0 ? `ランナー、${runners.join("と")}。` : "ランナーなし。";
        
        let tournamentText = "";
        if (s.gameMode === 'tournament') {
            const stageNames = { 1: "1回戦", 2: "準決勝", 3: "決勝戦" };
            tournamentText = `勝ち抜きトーナメント${stageNames[s.tournamentStage] || ""}。`;
        }

        const modeText = s.isBottom ? "あなたの守備、ピッチングです。" : `あなたの攻撃、バッティングです。あなたの調子は${this.getConditionName(s.playerCondition)}。`;
        const countText = `カウントは、${s.balls}ボール、${s.strikes}ストライク、${s.outs}アウト。`;
        const scoreText = `現在のスコアは、あなた ${s.score.player}点、対、CPU ${s.score.cpu}点。`;
        const inningText = `イニングは、${s.inning}回${s.isBottom ? '裏' : '表'}。`;
        
        const text = `${tournamentText}${inningText} ${modeText} ${scoreText} ${countText} ${runnersText}`;
        this.announce(text, 'assertive');
    }
};

// ゲームのロード開始
window.addEventListener('DOMContentLoaded', () => {
    Game.init();
});
