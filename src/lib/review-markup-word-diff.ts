/**
 * Diff de palabras simple (LCS sobre tokens por espacios). Sin dependencias externas.
 */
export function wordLevelDiffSnippet(a: string, b: string, maxTokens = 48): string {
  const ta = a.trim().split(/\s+/).filter(Boolean);
  const tb = b.trim().split(/\s+/).filter(Boolean);
  if (ta.length === 0 && tb.length === 0) return '';
  if (ta.join(' ') === tb.join(' ')) return '';

  const n = ta.length;
  const m = tb.length;
  const capN = Math.min(n, maxTokens);
  const capM = Math.min(m, maxTokens);
  const dp: number[][] = Array.from({ length: capN + 1 }, () => Array(capM + 1).fill(0));
  for (let i = capN - 1; i >= 0; i -= 1) {
    for (let j = capM - 1; j >= 0; j -= 1) {
      dp[i]![j]! =
        ta[i] === tb[j] ? 1 + dp[i + 1]![j + 1]! : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < capN && j < capM) {
    if (ta[i] === tb[j]) {
      out.push(tb[j]!);
      i += 1;
      j += 1;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      out.push(`[-${ta[i]}]`);
      i += 1;
    } else {
      out.push(`[+${tb[j]}]`);
      j += 1;
    }
  }
  while (i < capN) {
    out.push(`[-${ta[i]}]`);
    i += 1;
  }
  while (j < capM) {
    out.push(`[+${tb[j]}]`);
    j += 1;
  }
  let s = out.join(' ');
  if (n > capN || m > capM) s += ' …';
  return s.slice(0, 420) + (s.length > 420 ? '…' : '');
}
