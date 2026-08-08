# 技術スタック比較（v0.1）

前提: このアプリの品質は **「確実に鳴るか」** でほぼ決まる。
UIの綺麗さや開発の速さより、**OSのアラーム機構にどれだけ深くアクセスできるか**で選ぶ。

---

## 候補比較

| | A. Expo (React Native) | B. Flutter | C. Android ネイティブ | D. PWA |
|---|---|---|---|---|
| 言語 | TypeScript | Dart | Kotlin | TypeScript |
| 既存スキル活用 | ◎ (travel-planner で React経験) | △ (Dart新規学習) | △ (Kotlin新規学習) | ◎ |
| Android アラーム信頼性 | ○ (Notifee経由) | ◎ | ◎◎ | × |
| iOS アラーム信頼性 | △ | ○ (最良の妥協) | — | × |
| 開発速度 | ◎ | ○ | △ | ◎◎ |
| Mac必須 (iOS配布時) | 必要 | 必要 | 不要 | 不要 |
| Windowsでの開発 | ◎ (Android実機で完結) | ◎ | ◎ | ◎ |
| 実機配布の手軽さ | ○ (EAS Build) | ○ | ◎ (APK直接) | ◎◎ |

---

## A. Expo (React Native) + Notifee 【推奨: 両OS対応したいなら】

```
Expo SDK (Dev Client / CNG)
├─ @notifee/react-native   … アラーム通知の本体（フルスクリーン/AlarmManager対応）
├─ expo-av or react-native-track-player … 音の再生とループ
├─ expo-camera             … QRコード読取
├─ expo-sensors            … 歩数/シェイク検知
├─ expo-keep-awake         … 画面を消させない
├─ expo-sqlite or MMKV     … ローカル保存
└─ EAS Build               … クラウドでビルド (Windowsのままでも可)
```

**採用理由**
- React/TypeScript の既存スキルがそのまま使える（学習コストが最小）
- **Notifee** が Android の `AlarmManager` + フルスクリーン通知 + フォアグラウンドサービスをラップしてくれる（Invertase製・無料）
- `expo-notifications` 単体では正確なアラームは作れないので **Notifee はほぼ必須**

**注意点**
- Expo Go では動かない。`expo prebuild` + Dev Client が必要
- 音を止めさせない/離脱を検知する部分は、最終的にネイティブモジュールを自分で書く必要が出る可能性あり
- iOS の制約はどのスタックでも同じだが、React Native 層では回避策が組みにくい

---

## B. Flutter + alarm パッケージ 【推奨: iPhoneがメイン端末なら】

```
Flutter
├─ alarm (gdelataillade/alarm) … iOS/Android両対応、サイレントモードでも鳴らす実装
├─ android_alarm_manager_plus  … Android側の正確なスケジューリング
├─ mobile_scanner              … QR読取
├─ sensors_plus / pedometer    … 歩数・シェイク
└─ drift or sqflite            … ローカル保存
```

**採用理由**
- `alarm` パッケージが「iOSでいかにアラームを鳴らし続けるか」という**最難関の問題に正面から取り組んでいる**（バックグラウンド音声セッションを維持する方式）
- iOS の妥協ラインとしては、現状最も実績のある選択肢
- UIも作りやすく、両OSで見た目が揃う

**注意点**
- Dart の学習が必要（Reactに慣れていれば1週間程度で書ける、宣言的UIの考え方は共通）
- iOSでの挙動はあくまで「ベストエフォート」。OSに殺される可能性はゼロではない

---

## C. Android ネイティブ (Kotlin + Jetpack Compose) 【推奨: Android専用なら】

```
Kotlin + Jetpack Compose
├─ AlarmManager.setAlarmClock()  … Doze突破・最優先スケジューリング
├─ ForegroundService (mediaPlayback) … 鳴り続ける本体
├─ Full-screen Intent + Activity  … ロック画面上に全画面表示
├─ CameraX + ML Kit Barcode      … QR読取
├─ Room                          … ローカル保存
└─ WorkManager                   … 再起動後のアラーム再登録
```

**採用理由**
- **信頼性が最高**。純正時計アプリと同じ土俵で戦える
- 「離脱を検知して画面に戻す」「音量を下げさせない」など、抜け道封じの実装が唯一まともにできる
- ビルドしたAPKをそのまま自分の端末に入れられる（ストア審査不要）

**注意点**
- Android 専用。iPhone に移行する予定があるなら不採用
- Kotlin + Compose の学習コスト（ただし目的が明確なので範囲は限定的）

---

## D. PWA 【本番には不採用。ただしPhase 0として有用】

正確な時刻にバックグラウンドから発火する手段が Web には存在しない。
「画面を点けたまま枕元に置く」前提なら成立するが、電池と信頼性の面で本番運用に耐えない。

**ただし**、以下の用途では非常に有効:
- 解除タスクのUI/難易度を試作して、実際に自分で解いてみる
- 「どのタスクなら本当に目が覚めるか」を、アプリ本体を作る前に検証する

---

## 推奨する進め方

```
Phase 0 (数日)   PWA or 単一HTMLでタスクUIだけ試作
                 → 「計算3問」「QR読取」を実際に朝やってみて覚醒効果を体感で検証
                    ここで本命タスクを1つに絞る

Phase 1 (2週間)  本番スタックでMVP実装
                 アラーム登録 → 発火 → タスク → 解除 → ログ

Phase 2          不正防止の強化、統計、タスク追加
```

Phase 0 を挟む理由: **一番のリスクは「作ったのに目が覚めない」こと**。
アラーム基盤の実装は重いので、その前にタスク設計を潰しておく価値が高い。

---

## 結論（論点1「対象端末」の回答待ち）

| 使う端末 | 推奨スタック |
|---|---|
| Android のみ | **C. Kotlin ネイティブ**（信頼性が段違い。他に選ぶ理由がない） |
| iPhone のみ | **B. Flutter + alarm**（iOSの制約下では最良の妥協） |
| 両方 / 将来公開したい | **A. Expo + Notifee**（既存スキルが活き、iOSは割り切る） |
| まず試作だけ | **D. PWA**（Phase 0 として） |
