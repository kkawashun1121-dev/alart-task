/**
 * Step 1: 音を鳴らす / 止める（参考コード）
 * ============================================================
 * 置き場所: app/src/audio/beeper.ts
 *
 * このステップの目標:
 *   ボタンを押すと爆音が鳴り、もう一度押すと止まる。それだけ。
 *   タイマーもカメラもまだ書かない。
 *
 * 【なぜ音源ファイル(mp3)を使わないのか】
 *   Web Audio API で波形を合成すれば、ファイルの読み込み待ちも
 *   読み込み失敗も起こりません。目覚ましは「確実に鳴る」ことが
 *   最優先なので、外部ファイルへの依存をゼロにします。
 *
 * 【iOS Safari の鉄則 — ここが最大の地雷】
 *   iOS は「ユーザーが操作していないのに音が鳴る」ことを禁止しています。
 *   ただし、いちどタップの中で AudioContext を作っておけば、
 *   そのあとはプログラムから自由に鳴らせます。
 *   → つまり「就寝前のセットボタン」で仕込んでおくのが必須です。
 */

/** 鳴り方の設定。あとで好みに変えてください */
const PULSE_INTERVAL_MS = 400; // ピッ…ピッ… の間隔
const FREQ_LOW = 880;          // ラ の音
const FREQ_HIGH = 1174;        // レ の音（交互に鳴らすと救急車っぽくなる）
const VOLUME = 0.9;            // 0〜1。目覚ましなので遠慮しない

/**
 * ゲイン（音量）を 0 にはできないので、代わりに使う極小値。
 * 理由: 後で使う exponentialRampToValueAtTime は 0 を受け付けない
 *      （指数カーブは 0 に到達できないため）。
 */
const SILENT = 0.0001;

export class Beeper {
  private ctx: AudioContext | null = null;
  private keepAlive: AudioBufferSourceNode | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private timer: number | null = null;

  /** unlock() 済みかどうか。UI でボタンの出し分けに使う */
  get isReady() {
    return this.ctx !== null;
  }

  get isBeeping() {
    return this.osc !== null;
  }

  /**
   * 音を出す権利を獲得する。
   * ⚠️ 必ず onClick ハンドラの中から呼ぶこと。
   *    setTimeout や useEffect の中から呼んでも iOS では効きません。
   *    「タップから始まった処理の流れ」であることが条件です。
   */
  async unlock() {
    if (this.ctx) return; // 二重に作らない

    // Safari は古い名前でしか生えていないことがあるので両対応にする
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;

    this.ctx = new Ctor();
    await this.ctx.resume();
    this.startKeepAlive();
  }

  /** 鳴らし始める */
  start() {
    if (!this.ctx || this.osc) return; // 未 unlock、または既に鳴っている

    // 音量つまみ。ここを操作して「ピッ、ピッ」を作る
    this.gain = this.ctx.createGain();
    this.gain.gain.value = SILENT;
    this.gain.connect(this.ctx.destination);

    // 音の源。矩形波はギザギザした耳障りな音になる（＝起きやすい）
    this.osc = this.ctx.createOscillator();
    this.osc.type = 'square';
    this.osc.frequency.value = FREQ_LOW;
    this.osc.connect(this.gain);
    this.osc.start(); // 以後、鳴りっぱなし。音量で断続させる

    let high = false;

    const pulse = () => {
      if (!this.ctx || !this.osc || !this.gain) return;
      high = !high;

      const t = this.ctx.currentTime; // Web Audio 内部の時計（秒）

      // 高い音と低い音を交互に
      this.osc.frequency.setValueAtTime(high ? FREQ_HIGH : FREQ_LOW, t);

      // これから予約を入れ直すので、古い予約を捨てる
      this.gain.gain.cancelScheduledValues(t);

      // 音量の設計図を「未来の時刻」に予約する。
      // JS のタイマーは数十ms ずれるが、この予約はオーディオ側の正確な時計で実行される。
      this.gain.gain.setValueAtTime(SILENT, t);
      this.gain.gain.exponentialRampToValueAtTime(VOLUME, t + 0.02); // 立ち上げ
      this.gain.gain.setValueAtTime(VOLUME, t + 0.3);                // 保つ
      this.gain.gain.exponentialRampToValueAtTime(SILENT, t + 0.38); // 切る
    };

    pulse(); // 1回目は即座に
    this.timer = window.setInterval(pulse, PULSE_INTERVAL_MS);
  }

  /** 止める。AudioContext は閉じない（次にすぐ鳴らせるように残す） */
  stop() {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.osc?.stop();
    this.osc?.disconnect();
    this.gain?.disconnect();
    this.osc = null;
    this.gain = null;
  }

  /** アプリを終わるとき用。ここまで呼べば完全に片付く */
  async dispose() {
    this.stop();
    this.keepAlive?.stop();
    this.keepAlive?.disconnect();
    this.keepAlive = null;
    await this.ctx?.close();
    this.ctx = null;
  }

  /**
   * 聞こえないレベルのノイズを流し続けて AudioContext を生かしておく。
   *
   * 【なぜ必要か】
   *   何も鳴らさない時間が続くと、ブラウザが AudioContext を
   *   suspended（休止）にしてしまうことがあります。就寝から起床まで
   *   数時間空くこのアプリでは致命的です。
   *   完全な無音だと「鳴っていない」と判定されるため、あえて極小の
   *   ノイズを入れます（1e-6 なので人間には絶対に聞こえません）。
   */
  private startKeepAlive() {
    if (!this.ctx) return;

    const sr = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, sr, sr); // 1秒ぶんの箱
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() - 0.5) * 1e-6;
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true; // 1秒を延々ループ
    src.connect(this.ctx.destination);
    src.start();

    this.keepAlive = src;
  }
}

/** アプリ全体で 1 個だけ使う */
export const beeper = new Beeper();
