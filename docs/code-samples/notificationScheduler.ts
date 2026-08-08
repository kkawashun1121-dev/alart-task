/**
 * 副系: ローカル通知の連打（参考コード）
 * ============================================================
 * 主系（alarmEngine のキープアライブ）が OS に殺された場合の保険。
 * 就寝時に「起床時刻から1分間隔で60個」の通知を予約しておく。
 *
 * これが「タスクをこなさないとすぐスヌーズが出る」の実体になる。
 * 通知1個あたり音は最長30秒だが、1分ごとに鳴り直すので実質鳴りっぱなしになる。
 *
 * 【iOSの制約】
 *   - 保留できるローカル通知は最大 64 個。超えた分は無言で捨てられる
 *   - 通知音は 30 秒以内のファイルのみ（.wav / .caf / .aiff）
 *   - 集中モードを突破するには interruptionLevel: 'timeSensitive' が必要
 *     → Apple Developer の Certificates, Identifiers & Profiles で
 *       「Time Sensitive Notifications」capability を自分で有効化する（審査不要）
 *     → Critical Alerts は Apple の個別承認が必要なので使わない
 */

import * as Notifications from 'expo-notifications';

/** スヌーズ間隔（分）。この値は storage.ts のスヌーズ回数計算と必ず一致させること */
export const SNOOZE_INTERVAL_MIN = 1;

/** 予約する通知の個数。iOSの上限64に対して余裕を持たせる */
const CHAIN_LENGTH = 60;

/** アプリが前面にある間の通知の扱い。音は主系が鳴らすのでここでは鳴らさない */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: false,
    shouldPlaySound: false, // 前面にいるときは alarmEngine が鳴らしているので二重に鳴らさない
    shouldSetBadge: false,
  }),
});

/** 初回起動時に呼ぶ */
export async function requestNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowSound: true,
      allowBadge: false,
      // Critical Alerts は Apple の承認が必要なので要求しない
      allowCriticalAlerts: false,
      provideAppNotificationSettings: true,
    },
  });
  return status === 'granted';
}

/**
 * 就寝時に呼ぶ。起床時刻から SNOOZE_INTERVAL_MIN 間隔で通知を並べる。
 * @param alarmAt 起床時刻
 */
export async function scheduleAlarmChain(alarmAt: Date): Promise<number> {
  // 前回のぶんが残っていると混ざるので必ず消してから
  await Notifications.cancelAllScheduledNotificationsAsync();

  let scheduled = 0;

  for (let i = 0; i < CHAIN_LENGTH; i++) {
    const fireAt = new Date(alarmAt.getTime() + i * SNOOZE_INTERVAL_MIN * 60_000);

    // 過去の時刻は予約できない（即時発火してしまう）ので飛ばす
    if (fireAt.getTime() <= Date.now()) continue;

    await Notifications.scheduleNotificationAsync({
      identifier: `alarm-chain-${i}`,
      content: {
        title: i === 0 ? '⏰ 起きる時間です' : `😴 スヌーズ ${i} 回目`,
        body: '今日の日付が写ったものを撮影するまで止まりません',
        sound: 'alarm.wav', // 30秒以内。assets に置いて app.json の expo-notifications プラグインで登録する
        interruptionLevel: 'timeSensitive', // 集中モード/おやすみモードを突破
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: fireAt,
      },
    });
    scheduled++;
  }

  return scheduled;
}

/** タスク完了時に呼ぶ。予約と表示済みの通知を全部消す */
export async function cancelAlarmChain() {
  await Notifications.cancelAllScheduledNotificationsAsync();
  await Notifications.dismissAllNotificationsAsync();
}

/** デバッグ用。今いくつ予約されているか確認する */
export async function debugListScheduled() {
  const list = await Notifications.getAllScheduledNotificationsAsync();
  console.log(`予約中の通知: ${list.length} 件`);
  return list;
}

/* ------------------------------------------------------------------
 * app.json への追記例
 * ------------------------------------------------------------------
 * {
 *   "expo": {
 *     "plugins": [
 *       [
 *         "expo-notifications",
 *         {
 *           "sounds": ["./assets/alarm.wav"]
 *         }
 *       ],
 *       [
 *         "expo-audio",
 *         {
 *           "enableBackgroundPlayback": true
 *         }
 *       ],
 *       [
 *         "react-native-vision-camera",
 *         {
 *           "cameraPermissionText": "日付を撮影してアラームを解除するために使用します"
 *         }
 *       ]
 *     ],
 *     "ios": {
 *       "infoPlist": {
 *         "UIBackgroundModes": ["audio"]
 *       },
 *       "entitlements": {
 *         "com.apple.developer.usernotifications.time-sensitive": true
 *       }
 *     }
 *   }
 * }
 */
