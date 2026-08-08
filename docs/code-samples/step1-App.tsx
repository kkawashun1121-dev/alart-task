/**
 * Step 1: 動作確認用の画面（参考コード）
 * ============================================================
 * 置き場所: app/src/App.tsx（テンプレートの中身を全部消して差し替え）
 *
 * ボタン2つだけの画面です。iPhone の Safari で開いて、
 *   「音を有効にする」→「鳴らす」→「止める」
 * が期待どおりに動くかを確かめます。
 */

import { useState } from 'react';
import { beeper } from './audio/beeper';

export default function App() {
  const [ready, setReady] = useState(false);
  const [beeping, setBeeping] = useState(false);

  /**
   * ⚠️ async にしているが、await より前の処理はタップと同じ流れで実行される。
   *    unlock() の中で AudioContext を作るので、これで iOS の条件を満たす。
   */
  const handleUnlock = async () => {
    await beeper.unlock();
    setReady(true);
  };

  const handleStart = () => {
    beeper.start();
    setBeeping(true);
  };

  const handleStop = () => {
    beeper.stop();
    setBeeping(false);
  };

  return (
    <main style={styles.main}>
      <h1 style={styles.title}>Step 1: 音の確認</h1>

      {!ready ? (
        <>
          <button style={styles.button} onClick={handleUnlock}>
            音を有効にする
          </button>
          <p style={styles.note}>
            iPhone の消音スイッチをオフにして、音量を上げてから押してください。
          </p>
        </>
      ) : (
        <>
          <button
            style={styles.button}
            onClick={beeping ? handleStop : handleStart}
          >
            {beeping ? '止める' : '鳴らす'}
          </button>
          <p style={styles.note}>
            状態: {beeping ? '鳴動中' : '待機中'}
          </p>
        </>
      )}
    </main>
  );
}

/** スタイルは後でまとめて整えるので、いまはインラインで十分 */
const styles: Record<string, React.CSSProperties> = {
  main: {
    minHeight: '100dvh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
    fontFamily: 'system-ui, sans-serif',
    background: '#111',
    color: '#eee',
  },
  title: { fontSize: 20, fontWeight: 600 },
  button: {
    fontSize: 24,
    padding: '20px 48px',
    borderRadius: 16,
    border: 'none',
    background: '#e2483d',
    color: '#fff',
    // iOS で長押ししたときに選択・拡大されるのを防ぐ
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
  },
  note: { fontSize: 14, opacity: 0.7, textAlign: 'center', padding: '0 24px' },
};
