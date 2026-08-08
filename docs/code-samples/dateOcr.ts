/**
 * 日付照合ロジック（参考コード / PWA版）
 * ============================================================
 * カメラ映像から文字を読み取り、「今日の日付」が写っているかを判定する。
 * Tesseract.js を使うので完全にブラウザ内で完結する（無料・初回以降オフライン可）。
 *
 * 【方針】
 *   日本語モデル(jpn)は十数MBあり重く精度も不安定なため使わない。
 *   英語モデル(eng) + 「数字と区切り文字だけ」のホワイトリストに絞ることで、
 *   軽量・高速・高精度にする。その代わり判定できるのは 2026/08/08 形式に限定される。
 *
 *   → 運用: 前夜に紙へ「2026/08/08」と大きく手書きして洗面所に貼る。
 *     レシートも日付が数字形式で印字されていればそのまま使える。
 *
 * 【設計上の工夫】
 *   checkTextContainsToday() は外部依存のない純粋関数にしてある。
 *   カメラもOCRも無しで単体テストできるので、まずここから書くのがおすすめ。
 */

import { createWorker, type Worker } from 'tesseract.js';

export type DateCheckResult =
  | { ok: true; matched: string; rawText: string }
  | {
      ok: false;
      reason: 'no-date-found' | 'date-mismatch';
      found: string[];
      rawText: string;
    };

type YMD = { y: number; m: number; d: number };

// ====================================================================
// 1. 判定ロジック（純粋関数。ここだけ単体テストできる）
// ====================================================================

/** OCR の典型的な誤認識を数字側に寄せた文字列を作る */
function normalizeDigits(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全角→半角
    .replace(/[Oo]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8');
}

/** 前後が数字でないことを確認する（lookbehind を避けて手動判定） */
function isStandalone(text: string, start: number, length: number): boolean {
  if (start > 0 && /\d/.test(text[start - 1])) return false;
  const end = start + length;
  if (end < text.length && /\d/.test(text[end])) return false;
  return true;
}

/** 年月日がそろっている日付を全部抜き出す */
function extractFullDates(text: string): YMD[] {
  const out: YMD[] = [];
  const push = (y: number, m: number, d: number) => {
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) out.push({ y, m, d });
  };

  // 2026/8/8 / 2026-08-08 / 2026.8.8 / 2026年8月8日
  for (const m of text.matchAll(
    /(\d{4})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/g
  )) {
    push(+m[1], +m[2], +m[3]);
  }

  // 26/08/08（2桁年）。4桁年の一部を誤って拾わないよう前後をチェックする
  for (const m of text.matchAll(/(\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/g)) {
    if (m.index === undefined) continue;
    if (!isStandalone(text, m.index, m[0].length)) continue;
    push(2000 + +m[1], +m[2], +m[3]);
  }

  // 令和8年8月8日 / R8.8.8（令和1年 = 2019年 なので +2018）
  // ※ ホワイトリストを数字のみにしている場合は効かない。日本語モデルを使う場合の保険
  for (const m of text.matchAll(
    /(?:令和|R)\s*(\d{1,2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/gi
  )) {
    push(2018 + +m[1], +m[2], +m[3]);
  }

  return out;
}

/**
 * 年が書かれていない「8/8」「8月8日」形式。
 * 手書きメモでは年が省略されがちなので許容する。
 * 厳しくしたい場合はこの関数を呼ばないようにすればよい。
 */
function extractMonthDay(text: string): Array<{ m: number; d: number }> {
  const out: Array<{ m: number; d: number }> = [];
  const push = (mm: number, dd: number) => {
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) out.push({ m: mm, d: dd });
  };

  for (const m of text.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) {
    push(+m[1], +m[2]);
  }
  for (const m of text.matchAll(/(\d{1,2})[\/\-.](\d{1,2})/g)) {
    if (m.index === undefined) continue;
    if (!isStandalone(text, m.index, m[0].length)) continue;
    push(+m[1], +m[2]);
  }
  return out;
}

/**
 * テキストに今日の日付が含まれているか判定する。
 * @param rawText OCR で読み取った全文
 * @param now     判定基準の時刻（テストで差し替えられるよう引数化）
 */
export function checkTextContainsToday(
  rawText: string,
  now: Date = new Date()
): DateCheckResult {
  const y = now.getFullYear();
  const mo = now.getMonth() + 1;
  const d = now.getDate();

  // 元テキストと、誤認識を補正したテキストの両方で試す
  const candidates = [rawText, normalizeDigits(rawText)];
  const found: string[] = [];

  for (const text of candidates) {
    for (const c of extractFullDates(text)) {
      found.push(`${c.y}/${c.m}/${c.d}`);
      if (c.y === y && c.m === mo && c.d === d) {
        return { ok: true, matched: `${c.y}/${c.m}/${c.d}`, rawText };
      }
    }
    for (const c of extractMonthDay(text)) {
      found.push(`${c.m}/${c.d}`);
      if (c.m === mo && c.d === d) {
        return { ok: true, matched: `${c.m}/${c.d}`, rawText };
      }
    }
  }

  return {
    ok: false,
    reason: found.length > 0 ? 'date-mismatch' : 'no-date-found',
    found: Array.from(new Set(found)),
    rawText,
  };
}

/** 失敗理由を寝ぼけた頭でも分かる日本語にする */
export function describeFailure(
  result: Extract<DateCheckResult, { ok: false }>
): string {
  if (result.reason === 'no-date-found') {
    return '日付が読み取れませんでした。枠の中に収めて、もっと近づいて撮ってください。';
  }
  return `日付は読めましたが今日ではありません（読めたもの: ${result.found
    .slice(0, 3)
    .join(', ')}）`;
}

// ====================================================================
// 2. 画像の前処理（OCR精度はここで決まる）
// ====================================================================

/** 撮影ガイド枠。画面に表示する枠とこの比率を必ず一致させること */
export const GUIDE_RECT = { x: 0.08, y: 0.4, w: 0.84, h: 0.2 } as const;

/**
 * カメラ映像から枠内を切り出し、OCRしやすい白黒画像に変換する。
 * 全画面を渡すより、枠で絞ってコントラストを上げたほうが精度も速度も段違いに良くなる。
 */
export function captureForOcr(
  video: HTMLVideoElement,
  guide: { x: number; y: number; w: number; h: number } = GUIDE_RECT,
  scale = 2
): HTMLCanvasElement {
  const vw = video.videoWidth;
  const vh = video.videoHeight;

  const sx = Math.round(vw * guide.x);
  const sy = Math.round(vh * guide.y);
  const sw = Math.round(vw * guide.w);
  const sh = Math.round(vh * guide.h);

  const canvas = document.createElement('canvas');
  canvas.width = sw * scale; // 拡大しておくと小さい文字の認識率が上がる
  canvas.height = sh * scale;

  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  binarize(ctx, canvas.width, canvas.height);
  return canvas;
}

/**
 * グレースケール化して大津の方法で二値化する。
 * 照明ムラのある朝の洗面所でも安定して読めるようにするための処理。
 */
function binarize(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data;
  const hist = new Array(256).fill(0);

  // グレースケール化しつつヒストグラムを作る
  for (let i = 0; i < px.length; i += 4) {
    const g = (px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) | 0;
    px[i] = px[i + 1] = px[i + 2] = g;
    hist[g]++;
  }

  // 大津の方法でしきい値を求める（クラス間分散が最大になる値）
  const total = w * h;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];

  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);

    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }

  for (let i = 0; i < px.length; i += 4) {
    const v = px[i] > threshold ? 255 : 0;
    px[i] = px[i + 1] = px[i + 2] = v;
  }

  ctx.putImageData(img, 0, 0);
}

// ====================================================================
// 3. OCR ワーカー
// ====================================================================

let workerPromise: Promise<Worker> | null = null;

/**
 * ワーカーの初期化は数秒かかるので使い回す。
 * アラームをセットした時点で先に温めておくと、朝の待ち時間がゼロになる。
 */
export function getOcrWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker('eng');
      await worker.setParameters({
        // 日付に出る文字だけに絞る。誤認識が激減して速度も上がる
        tessedit_char_whitelist: '0123456789/-.',
        // 1行のテキストとして扱う（枠で切り出しているので）
        tessedit_pageseg_mode: '7' as never,
      });
      return worker;
    })();
  }
  return workerPromise;
}

/** 就寝時に呼んでおくと朝が速い */
export async function warmUpOcr() {
  await getOcrWorker();
}

/**
 * カメラ映像を1枚判定する。
 * 失敗しても音は止めないので、呼び出し側でリトライさせること。
 */
export async function verifyFrameHasToday(
  video: HTMLVideoElement
): Promise<DateCheckResult> {
  const canvas = captureForOcr(video);
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(canvas);
  return checkTextContainsToday(data.text);
}

/* ------------------------------------------------------------------
 * 単体テスト例（vitest。ブラウザもカメラも不要でそのまま動く）
 * ------------------------------------------------------------------
 * import { describe, it, expect } from 'vitest';
 * import { checkTextContainsToday } from './dateOcr';
 *
 * const TODAY = new Date(2026, 7, 8); // 2026-08-08
 *
 * describe('checkTextContainsToday', () => {
 *   it('レシート形式を通す',   () => expect(checkTextContainsToday('2026/08/08 10:23', TODAY).ok).toBe(true));
 *   it('ハイフン区切りを通す', () => expect(checkTextContainsToday('2026-08-08', TODAY).ok).toBe(true));
 *   it('年なしを通す',         () => expect(checkTextContainsToday('8/8', TODAY).ok).toBe(true));
 *   it('誤認識を救済する',     () => expect(checkTextContainsToday('2O26/O8/O8', TODAY).ok).toBe(true));
 *   it('昨日のレシートは弾く', () => expect(checkTextContainsToday('2026/08/07 19:40', TODAY).ok).toBe(false));
 *   it('日付なしは弾く',       () => expect(checkTextContainsToday('合計 1280円', TODAY).ok).toBe(false));
 * });
 */
