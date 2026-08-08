/**
 * 日付照合ロジック（参考コード）
 * ============================================================
 * 撮影した画像から文字を読み取り、「今日の日付」が写っているかを判定する。
 * OCR は ML Kit のオンデバイス実行なので、通信不要・無料・機内モードでも動く。
 *
 * checkTextContainsToday() は純粋関数なので、
 * ネイティブ環境なしで単体テストできる。まずここから書くのがおすすめ。
 */

import { PhotoRecognizer } from 'react-native-vision-camera-ocr-plus';

export type DateCheckResult =
  | { ok: true; matched: string; rawText: string }
  | {
      ok: false;
      reason: 'no-date-found' | 'date-mismatch';
      found: string[];
      rawText: string;
    };

type YMD = { y: number; m: number; d: number };

/**
 * OCR の典型的な誤認識を数字側に寄せた文字列を作る。
 * 元テキストと、この正規化テキストの両方で照合することで検出率を上げる。
 * （正規化すると日本語が壊れるので、あくまで「もう一つの候補」として使う）
 */
function normalizeDigits(s: string): string {
  return s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全角数字→半角
    .replace(/[Oo]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[Ss]/g, '5')
    .replace(/[Bb]/g, '8');
}

/** 前後が数字でないことを確認する（lookbehind は Hermes での挙動が不安定なので手動判定） */
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

  // 2026年8月8日 / 2026/8/8 / 2026-08-08 / 2026.8.8
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

  // 令和8年8月8日 / R8.8.8 （令和1年 = 2019年 なので +2018）
  for (const m of text.matchAll(
    /(?:令和|R)\s*(\d{1,2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/gi
  )) {
    push(2018 + +m[1], +m[2], +m[3]);
  }

  return out;
}

/**
 * 年が書かれていない「8月8日」形式。
 * レシートや手書きメモでは年が省略されがちなので、実用性を優先して許容する。
 * 厳しくしたい場合はこの関数を使わないようにすればよい。
 */
function extractMonthDay(text: string): Array<{ m: number; d: number }> {
  const out: Array<{ m: number; d: number }> = [];
  for (const m of text.matchAll(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) {
    const mm = +m[1];
    const dd = +m[2];
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) out.push({ m: mm, d: dd });
  }
  return out;
}

/**
 * テキストに今日の日付が含まれているか判定する。
 * @param rawText OCR で読み取った全文
 * @param now     判定基準の時刻（テストで差し替えられるように引数化）
 */
export function checkTextContainsToday(
  rawText: string,
  now: Date = new Date()
): DateCheckResult {
  const y = now.getFullYear();
  const mo = now.getMonth() + 1;
  const d = now.getDate();

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

/**
 * 撮影した写真を判定する。
 * @param photoPath vision-camera の takePhoto() が返す path
 */
export async function verifyPhotoHasToday(
  photoPath: string
): Promise<DateCheckResult> {
  const uri = photoPath.startsWith('file://') ? photoPath : `file://${photoPath}`;
  const result = await PhotoRecognizer({ uri, orientation: 'portrait' });
  return checkTextContainsToday(result.resultText);
}

/** 失敗理由を寝ぼけた頭でも分かる日本語にする */
export function describeFailure(result: Extract<DateCheckResult, { ok: false }>): string {
  if (result.reason === 'no-date-found') {
    return '日付が読み取れませんでした。もっと近づいて、明るいところで撮ってください。';
  }
  return `日付は読めましたが今日ではありません（読めた日付: ${result.found
    .slice(0, 3)
    .join(', ')}）`;
}

/* ------------------------------------------------------------------
 * 単体テスト例（jest。ネイティブ不要でそのまま動く）
 * ------------------------------------------------------------------
 * const TODAY = new Date(2026, 7, 8); // 2026-08-08
 *
 * test('レシート形式', () => {
 *   expect(checkTextContainsToday('ご来店ありがとうございます\n2026/08/08 10:23', TODAY).ok).toBe(true);
 * });
 * test('和暦', () => {
 *   expect(checkTextContainsToday('令和8年8月8日', TODAY).ok).toBe(true);
 * });
 * test('年なし手書き', () => {
 *   expect(checkTextContainsToday('8月8日', TODAY).ok).toBe(true);
 * });
 * test('昨日のレシートは弾く', () => {
 *   expect(checkTextContainsToday('2026/08/07 19:40', TODAY).ok).toBe(false);
 * });
 * test('OCR誤認識を救済', () => {
 *   expect(checkTextContainsToday('2O26/O8/O8', TODAY).ok).toBe(true);
 * });
 */
