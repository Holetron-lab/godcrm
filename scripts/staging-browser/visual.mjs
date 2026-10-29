// Conservative solid-color contrast; unsupported effects are inconclusive.
export function contrast({ color, backgrounds }) {
  const parse = value => {
    const m = /^rgba?\((\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)[, ]+(\d+(?:\.\d+)?)(?:\s*[,/]\s*(\d*\.?\d+))?\)$/.exec(value);
    return m ? [...m.slice(1, 4).map(Number), m[4] === undefined ? 1 : Number(m[4])] : null;
  };
  const foreground = parse(color);
  if (!foreground || backgrounds.some(x => Number(x.opacity) !== 1 || x.image !== 'none')) return NaN;
  let bg = [255, 255, 255];
  for (const layer of [...backgrounds].reverse()) {
    const c = parse(layer.color); if (!c) return NaN;
    bg = bg.map((n, i) => c[i] * c[3] + n * (1 - c[3]));
  }
  const fg = bg.map((n, i) => foreground[i] * foreground[3] + n * (1 - foreground[3]));
  const lum = c => c.map(n => n / 255).map(n => n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
  return (Math.max(lum(fg), lum(bg)) + .05) / (Math.min(lum(fg), lum(bg)) + .05);
}
