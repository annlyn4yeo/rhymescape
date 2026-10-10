const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** 0 to 999,999,999 as lowercase words ("24" to ["twenty", "four"]). Longer digit strings are read digit by digit. */
export function numberToWords(digits: string): string[] {
  if (!/^\d+$/.test(digits)) return [];
  if (digits.length > 9) return [...digits].map((d) => ONES[Number(d)]!);
  return below(Number(digits), [[1_000_000, 'million'], [1000, 'thousand']]);
}

function below(n: number, scales: ReadonlyArray<readonly [number, string]>): string[] {
  if (n === 0) return ['zero'];
  const out: string[] = [];
  let rest = n;
  for (const [size, name] of scales) {
    if (rest >= size) {
      out.push(...hundreds(Math.floor(rest / size)), name);
      rest %= size;
    }
  }
  if (rest > 0) out.push(...hundreds(rest));
  return out;
}

function hundreds(n: number): string[] {
  const out: string[] = [];
  if (n >= 100) {
    out.push(ONES[Math.floor(n / 100)]!, 'hundred');
    n %= 100;
  }
  if (n >= 20) {
    out.push(TENS[Math.floor(n / 10)]!);
    n %= 10;
    if (n > 0) out.push(ONES[n]!);
  } else if (n > 0) {
    out.push(ONES[n]!);
  }
  return out;
}
