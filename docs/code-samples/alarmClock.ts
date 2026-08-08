/**
 * PWA アラームエンジン（参考コード）
 * ============================================================
 * ブラウザだけで「タスクを完了するまで止まらないアラーム」を実装する。
 *
 * 【iOS Safari で守るべき鉄則】
 *  1. AudioContext は必ず「ユーザーのタップハンドラの中」で作る。
 *     後からプログラム的に音を鳴らすには、この最初の一手が必須。
 *  2. 一度作った AudioContext は止めない。極小音量のループを流し続けて
 *     suspended 状態にさせない。
 *  3. Screen Wake Lock で画面を消させない。画面が消えるとタイマーが止まる。
 *  4. 消音スイッチとシステム音量は Web からは操作できない。
 *     → 就寝前にオフ＆音量アップする運用でカバーする。
 */

/** スヌーズ間隔（ミリ秒）。短いほど二度寝しづらい */
export const SNOOZE_INTERVAL_MS = 3 * 60_000;

export type AlarmState = 'idle' | 'armed' | 'ringing' | 'snoozing';

export type TickInfo = {
  state: AlarmState;
  /** 次に鳴るまでの残り時間（ミリ秒）。鳴動中は 0 */
  remainingMs: number;
  snoozeCount: number;
};

export type AlarmEvents = {
  onStateChange?: (state: AlarmState) => void;
  onRing?: () => void;
  onTick?: (info: TickInfo) => void;
};

export class AlarmClock {
  private ctx: AudioContext | null = null;
  private keepAlive: AudioBufferSourceNode | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;

  private beepTimer: number | null = null;
  private tickTimer: number | null = null;
  private wakeLock: WakeLockSentinel | null = null;

  private state: AlarmState = 'idle';
  /** 次に鳴る時刻 */
  private nextRingAt = 0;
  /** 最初にセットした起床時刻（統計用に保持） */
  private originalAlarmAt = 0;
  private snoozeCount = 0;
  private events: AlarmEvents = {};

  getState() {
    return this.state;
  }
  getSnoozeCount() {
    return this.snoozeCount;
  }
  getOriginalAlarmAt() {
    return this.originalAlarmAt;
  }

  /**
   * アラームをセットする。
   * ⚠️ 必ず onClick などユーザー操作のハンドラから同期的に呼ぶこと。
   *    そうしないと iOS で音が鳴らせなくなる。
   */
  async arm(targetAt: Date, events: AlarmEvents = {}) {
    this.events = events;
    this.originalAlarmAt = targetAt.getTime();
    this.nextRingAt = targetAt.getTime();
    this.snoozeCount = 0;

    // --- ここが最重要。タップの流れの中で AudioContext を起こす ---
    this.ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();
    await this.ctx.resume();
    this.startKeepAlive();
    // ------------------------------------------------------------

    await this.acquireWakeLock();
    document.addEventListener('visibilitychange', this.handleVisibility);

    this.setState('armed');
    this.startTicking();
  }

  /** スヌーズ。音を止めて一定時間後に鳴り直す。回数が加算される */
  snooze() {
    if (this.state !== 'ringing') return;
    this.snoozeCount += 1;
    this.stopBeep();
    this.nextRingAt = Date.now() + SNOOZE_INTERVAL_MS;
    this.setState('snoozing');
  }

  /** タスク完了。すべて停止して片付ける */
  async complete() {
    this.stopBeep();
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    document.removeEventListener('visibilitychange', this.handleVisibility);
    await this.releaseWakeLock();

    this.keepAlive?.stop();
    this.keepAlive?.disconnect();
    this.keepAlive = null;
    await this.ctx?.close();
    this.ctx = null;

    this.setState('idle');
  }

  /** セットを取り消す（就寝前に気が変わった場合など） */
  async cancel() {
    await this.complete();
    this.snoozeCount = 0;
    this.originalAlarmAt = 0;
    this.nextRingAt = 0;
  }

  // ------------------------------------------------------------------
  // 内部処理
  // ------------------------------------------------------------------

  private setState(s: AlarmState) {
    this.state = s;
    this.events.onStateChange?.(s);
  }

  /**
   * 1秒ごとに現在時刻と比較する。
   * setTimeout で一発予約する方式にしないのは、ブラウザがタイマーを
   * 間引いたりスリープ復帰でズレたりするため。毎回 Date.now() を見れば累積誤差が出ない。
   */
  private startTicking() {
    this.tickTimer = window.setInterval(() => {
      const remaining = this.nextRingAt - Date.now();

      if (
        (this.state === 'armed' || this.state === 'snoozing') &&
        remaining <= 0
      ) {
        this.ring();
        return;
      }

      this.events.onTick?.({
        state: this.state,
        remainingMs: this.state === 'ringing' ? 0 : Math.max(0, remaining),
        snoozeCount: this.snoozeCount,
      });
    }, 1000);
  }

  private ring() {
    this.setState('ringing');
    void this.ctx?.resume(); // 念のため。裏に回っていた場合の復帰
    this.startBeep();
    this.events.onRing?.();
  }

  /**
   * アラーム音を合成する。音源ファイルを持たないので読み込み失敗のリスクがゼロ。
   * 矩形波を 880Hz / 1174Hz で交互に断続させる（救急車のような不快な音＝起きやすい）。
   */
  private startBeep() {
    if (!this.ctx || this.osc) return;

    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0.0001;
    this.gain.connect(this.ctx.destination);

    this.osc = this.ctx.createOscillator();
    this.osc.type = 'square';
    this.osc.frequency.value = 880;
    this.osc.connect(this.gain);
    this.osc.start();

    let high = false;
    const pulse = () => {
      if (!this.ctx || !this.gain || !this.osc) return;
      high = !high;
      const t = this.ctx.currentTime;
      this.osc.frequency.setValueAtTime(high ? 1174 : 880, t);
      // 0 に対して exponentialRamp は使えないので極小値を使う
      this.gain.gain.cancelScheduledValues(t);
      this.gain.gain.setValueAtTime(0.0001, t);
      this.gain.gain.exponentialRampToValueAtTime(0.9, t + 0.02);
      this.gain.gain.setValueAtTime(0.9, t + 0.3);
      this.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    };

    pulse();
    this.beepTimer = window.setInterval(pulse, 400);
  }

  private stopBeep() {
    if (this.beepTimer !== null) {
      clearInterval(this.beepTimer);
      this.beepTimer = null;
    }
    this.osc?.stop();
    this.osc?.disconnect();
    this.gain?.disconnect();
    this.osc = null;
    this.gain = null;
  }

  /**
   * 極小音量のループを流し続けて AudioContext を生かしておく。
   * 完全な無音だとブラウザに「何も鳴っていない」と判断されて止められることがあるため、
   * 聞こえないレベルのノイズを入れておく。
   */
  private startKeepAlive() {
    if (!this.ctx) return;
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() - 0.5) * 1e-6;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.ctx.destination);
    src.start();
    this.keepAlive = src;
  }

  private async acquireWakeLock() {
    if (!('wakeLock' in navigator)) return; // 非対応環境は諦める
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      this.wakeLock.addEventListener('release', () => {
        this.wakeLock = null;
      });
    } catch {
      // ユーザーが拒否した/バッテリー低下などで取得できないことがある
    }
  }

  private async releaseWakeLock() {
    try {
      await this.wakeLock?.release();
    } catch {
      /* noop */
    }
    this.wakeLock = null;
  }

  /** 画面復帰時に Wake Lock は自動で戻らないので取り直す */
  private handleVisibility = () => {
    if (document.visibilityState !== 'visible') return;
    void this.ctx?.resume();
    void this.acquireWakeLock();
  };
}

export const alarmClock = new AlarmClock();

/* ------------------------------------------------------------------
 * 使い方
 * ------------------------------------------------------------------
 * // 就寝前。必ず onClick の中から呼ぶ
 * <button onClick={() => {
 *   const t = new Date();
 *   t.setHours(6, 30, 0, 0);
 *   if (t.getTime() <= Date.now()) t.setDate(t.getDate() + 1); // 過去なら翌日
 *
 *   void alarmClock.arm(t, {
 *     onRing: () => setScreen('ringing'),
 *     onTick: (info) => setRemaining(info.remainingMs),
 *   });
 * }}>セット</button>
 *
 * // タスク合格時
 * await alarmClock.complete();
 */
