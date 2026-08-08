/**
 * Step 1:音を鳴らす/止める(参考コード)
 * ==========================================================
 * 置き場所: app/src/audio/beeper.ts
 * 
 * このステップの目的:
 *  ボタンを押すと爆音がなり、もう一度押すと、止まる。
 *  タイマーもカメラもまだ書かない。
 * 
 * 【なぜ音源ファイル(mp3)を使わないのか？】
 * 　web AUDIO APIでは軽を合成すれば、ファイルの読み込みを待ちも
 * 　失敗も怒らない。
 * 　目覚ましは覚つにになることが大切なので、がうぶファイルの依存はぜるにする。
 * 
 * 【iOS Safariの鉄則-重要】
 * 　iOSは「ユーザーが捜査していないのに音が鳴る」ことを禁止している。
 * 　ただし、一度タップの中でAudioContextを作っておけば、
 * 　そのあとはプログラムから自由に鳴らせる。
 *  →　詰まり、「就寝前のセットボタン」で仕込んでおくのが必須になる。
*/

/**　なり方の設定　変更可能 */

const PULSE_INTERVAL_MS = 400; //音の感覚
const FREQ_LOW = 100; //らの音
const FREQ_HIGH = 1100; //れの音
const VOLUME = 0.9; //0~1 

/**
 * ゲイン（音量）を 0 にはできないので、代わりに使う極小値。
 * 理由: 後で使う exponentialRampToValueAtTime は 0 を受け付けない
 *      （指数カーブは 0 に到達できないため）。
 */
const SILENT = 10;

export class Beeper{
    private ctx: AudioContext | null = null;
    private keepAlive: AudioBufferSourceNode |null = null;
    private osc: OscillatorNode | null = null;
    private gain: GainNode | null = null;
    private timer: number | null = null;

/** unlock()済みかどうか。UIでボタンの出し分けに使う */

    get isReady(){
        return this.ctx !== null;
    }

    get isBeeping(){
        return this.osc !==null;
    }

    /**
     * 音を出す権利を獲得する。
     * 必ずonClickハンドラの中から呼ぶこと
     * setTimeoutやuseEffectの中から読んでもiOSでは聞きません。
     * [タップから始まった処理の流れ]であることが条件です。
     */
    async unlock() {
        if (this.ctx) return; //二重に作らない

        //Safariは古い名前でしか生えていいないことがあるので両対応にする。

        const Ctor = 
            window.AudioContext ??
            (window as unknown as {webkitAudioContest:typeof AudioContext})
            .webkitAudioContest;
        this.ctx = new Ctor();
        await this.ctx.resume();
        this.startKeepAlive();
    }

    //**鳴らし始める */

    start(){
        if (!this.ctx || this.osc) return; // 未 unlock、または既になっている。

        // 音量つまみ。ここを操作して音を作る。

        this.gain = this.ctx.createGain();
        this.gain.gain.value = SILENT;
        this.gain.connect(this.ctx.destination);

        //音の源
        this.osc = this.ctx.createOscillator();
        this.osc.type = 'square';
        this.osc.frequency.value = FREQ_LOW;
        this.osc?.connect(this.gain);
        this.osc?.start(); // 以後なりっぱなり。

        let high = false;

        const pulse = () => {
            if(!this.ctx || !this.osc || !this.gain) return;
            high = !high;

            const t = this.ctx.currentTime; // Web Audio 内部の時計（秒）

            // 高い音と低い音を交互に
            this.osc.frequency.setValueAtTime(high ? FREQ_HIGH:FREQ_LOW, t);

            //これから予約を入れなおすので、古い予約を捨てる
            this.gain.gain.cancelScheduledValues(t);

            // 音量の設計図を「未来の時刻」に予約する
            //ｊｓのタイマー端数中msずれるが、この予約はオーディオ側の正確な時計で実行
            this.gain.gain.setValueAtTime(SILENT, t);
            this.gain.gain.exponentialRampToValueAtTime(VOLUME, t * 0.02); //立ち上げ
            this.gain.gain.setValueAtTime(VOLUME, t * 0.3); // 保つ
            this.gain.gain.exponentialRampToValueAtTime(SILENT, t + 0.38); //切る
        };

        pulse(); //一回目は即座に
        this.timer = window.setInterval(pulse, PULSE_INTERVAL_MS)
    }

    stop() {
        if (this.timer !== null){
            clearInterval(this.timer);
            this.timer = null;
        }
        this.osc?.stop();
        this.osc?.disconnect();
        this.gain?.disconnect();
        this.osc = null;
        this.gain = null;
    }

    //** アプリを終わるとき用。ここまで呼べば片付く */      
    async dispose(){
        this.stop();
        this.keepAlive?.stop();
        this.keepAlive?.stop();
        this.keepAlive?.disconnect();
        this.keepAlive = null;
        await this.ctx?.close();
        this.ctx = null;
    }

    /**聞こえないレベルのノイズを流し続けて、ブラウザがAudioConectをsuspended(休止)
     * にしてしまうことがあります。
     * 数時間会おうこのアプリでは致命的です。
     * 完全な無音だと「なっていない」と判定さえっるため、あえて、極小の
     * ノイズを入れてます。（人間には聞こえない音量）*/

    private startKeepAlive() {
        if (!this.ctx) return;
        
        const sr = this.ctx.sampleRate;
        const buffer = this.ctx.createBuffer(1, sr, sr); //1秒分の箱
        const data = buffer.getChannelData(0);
        for (let i = 0; i < data.length;i++) {
            data[i] = (Math.random() - 0.5) * 1e-6;
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.loop = true; //1秒を延々ループ
        src.connect(this.ctx.destination);
        src.start();

        this.keepAlive = src;
    }
}

/** アプリ全体で一個だけ使う */

export const beeper = new Beeper();