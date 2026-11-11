// Generuje komplet ikon PWA z jednego pliku SVG (Playwright + Chromium).
// Użycie: node make-icons.js ikona.svg katalog/icons "#kolor-tla"
//  - icon-192.png, icon-512.png, favicon-32.png – SVG tak jak jest (może mieć przezroczyste rogi)
//  - icon-maskable-512.png – SVG zmniejszone do 76% na pełnym tle (Android przycina do koła/kwadratu)
//  - apple-touch-icon.png (180) – SVG 88% na pełnym tle, bez przezroczystości (iOS sam zaokrągla rogi)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [svgPath, outDir, bg = '#ffffff'] = process.argv.slice(2);
if (!svgPath || !outDir) {
  console.error('Użycie: node make-icons.js ikona.svg katalog/icons "#kolor-tla"');
  process.exit(1);
}
const src = 'data:image/svg+xml;base64,' + fs.readFileSync(svgPath).toString('base64');
fs.mkdirSync(outDir, { recursive: true });

const jobs = [
  ['icon-192.png', 192, 1, null],
  ['icon-512.png', 512, 1, null],
  ['favicon-32.png', 32, 1, null],
  ['icon-maskable-512.png', 512, 0.76, bg],
  ['apple-touch-icon.png', 180, 0.88, bg],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const [name, size, scale, fill] of jobs) {
    await page.setViewportSize({ width: size, height: size });
    const inner = Math.round(size * scale);
    await page.setContent(`<style>html,body{margin:0;width:${size}px;height:${size}px;background:${fill || 'transparent'};display:grid;place-items:center}img{width:${inner}px;height:${inner}px}</style><img src="${src}">`);
    await page.waitForFunction(() => document.querySelector('img').complete);
    await page.screenshot({ path: path.join(outDir, name), omitBackground: !fill });
    console.log('✓', name);
  }
  await browser.close();
})();
