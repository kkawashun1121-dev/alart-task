/**
 * 主系アラームエンジン（参考コード）
 * ============================================================
 * iOS には Android の AlarmManager に相当する仕組みが無い。
 * そこで「無音の音声をループ再生し続けてアプリをOSに殺させない」方式を使う。
 * Alarmy など市販の目覚ましアプリも同じ手法を取っている。
 *
 *   就寝時 : arm()    → 無音ループ開始。アプリはバックグラウンドでも生き続ける
 *   起床時 : 内部タイマーが検知 → 爆音ループへ切り替え
 *   解除時 : disarm() → 全部停止
 *
 * 【前提条件】
 *   - app.json の expo-audio プラグインで UIBackgroundModes: ["audio"] が入っていること
 *   - 充電しながら就寝すること（オーディオセッションを維持するため電池を食う）
 *
 * 【限界】
 *   iOS がメモリ不足などでアプリを殺す可能性はゼロではない。
 *   そのため notificationScheduler.ts（副系）を必ず併用すること。
 */

import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

// assets に置くファイル
//   silence-1s.wav … 無音1秒。アプリを生かしておくためだけに再生する
//   alarm.wav      … 実際のアラーム音。ループ前提なので繋ぎ目が自然なものを選ぶ
const SILENCE_SOURCE = require('../assets/silence-1s.wav');
const ALARM_SOURCE = require('../assets/alarm.wav');

export type AlarmEngineState = 'idle' | 'armed' | 'ringing';

class AlarmEngine {
  private silencePlayer: AudioPlayer | null = null;
  private alarmPlayer: AudioPlayer | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private state: AlarmEngineState = 'idle';
  private targetAt = 0;
  private onRing?: () => void;

  getState() {
    return this.state;
  }

  getTargetAt() {
    return this.targetAt;
  }

  /**
   * 就寝時に呼ぶ。指定時刻まで無音を鳴らし続けてアプリを生かす。
   * @param targetAt 起床時刻
   * @param onRing   鳴り始めたときに呼ばれる（画面遷移などに使う）
   */
  async arm(targetAt: Date, onRing: () => void) {
    await this.configureAudioSession();

    this.targetAt = targetAt.getTime();
    this.onRing = onRing;

    this.silencePlayer = createAudioPlayer(SILENCE_SOURCE);
    this.silencePlayer.loop = true;
    // 完全な 0 にすると iOS がオーディオセッションを不要とみなして落とすことがあるため、
    // 聞こえないが 0 ではない値にしておく
    this.silencePlayer.volume = 0.001;
    this.silencePlayer.play();

    // setTimeout はバックグラウンドで大幅に遅延・間引きされるので使わない。
    // 1秒ポーリングで「目標時刻を過ぎたか」を判定するほうが確実。
    this.tickTimer = setInterval(() => this.tick(), 1000);
    this.state = 'armed';
  }

  private tick() {
    if (this.state !== 'armed') return;
    if (Date.now() >= this.targetAt) {
      void this.ring();
    }
  }

  /** 実際に鳴らす。タスクを完了するまで永久にループする */
  private async ring() {
    this.state = 'ringing';

    this.silencePlayer?.pause();

    this.alarmPlayer = createAudioPlayer(ALARM_SOURCE);
    this.alarmPlayer.loop = true;
    this.alarmPlayer.volume = 1.0;
    this.alarmPlayer.play();

    this.onRing?.();
  }

  /**
   * 音量を段階的に上げたい場合はこれを ring() の中で使う。
   * いきなり爆音だと心臓に悪いので、10秒かけて上げるなど。
   */
  async fadeIn(durationMs = 10_000) {
    if (!this.alarmPlayer) return;
    const steps = 20;
    const interval = durationMs / steps;
    for (let i = 1; i <= steps; i++) {
      await new Promise((r) => setTimeout(r, interval));
      if (!this.alarmPlayer) return;
      this.alarmPlayer.volume = i / steps;
    }
  }

  /** タスク完了時に呼ぶ。すべて停止して初期状態に戻す */
  async disarm() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.alarmPlayer?.remove();
    this.silencePlayer?.remove();
    this.alarmPlayer = null;
    this.silencePlayer = null;
    this.state = 'idle';
    this.targetAt = 0;
    this.onRing = undefined;
  }

  /**
   * オーディオセッションの設定。ここがこのアプリの心臓部。
   *   playsInSilentMode      … 消音スイッチ（マナーモード）を無視して鳴らす
   *   shouldPlayInBackground … アプリを閉じても鳴り続ける
   *   interruptionMode       … 他アプリの音に割り込まれないようにする
   */
  private async configureAudioSession() {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
  }
}

// アプリ全体で1つだけ存在させる
export const alarmEngine = new AlarmEngine();

/* ------------------------------------------------------------------
 * バイブレーション（音と併用したい場合）
 * ------------------------------------------------------------------
 * iOS では React Native の Vibration.vibrate() のパターン再生に制限があるため、
 * expo-haptics を一定間隔で叩くほうが安定する。
 */
// import * as Haptics from 'expo-haptics';
//
// let hapticTimer: ReturnType<typeof setInterval> | null = null;
//
// export function startHaptics() {
//   if (hapticTimer) return;
//   hapticTimer = setInterval(() => {
//     void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
//   }, 1200);
// }
//
// export function stopHaptics() {
//   if (hapticTimer) {
//     clearInterval(hapticTimer);
//     hapticTimer = null;
//   }
// }
