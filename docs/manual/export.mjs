import { chromium, BASE, protectContext } from './capture/lib.mjs';

// Rebuild the downloadable guide from the same copy and existing images as /manual.

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  await protectContext(page.context());
  await page.goto(`${BASE}/manual`, { waitUntil: 'networkidle' });
  await page.evaluate(async () => {
    for (const image of document.images) image.loading = 'eager';
    await Promise.all([...document.images].map((image) => image.decode()));
    await document.fonts.ready;
  });
  await page.emulateMedia({ media: 'print' });
  await page.addStyleTag({
    content: `@media print {
    html { font-size: 14px; }
    .manual-step { flex-direction: row; gap: 24px; padding-block: 18px; }
    .manual-step > div:last-child:not(:first-child) { width: 190px; flex-shrink: 0; }
    .manual-step h4 { font-size: 17px; }
    .manual-step p { font-size: 14px; }
    main { padding-bottom: 0; }
    main > section:last-of-type { margin-bottom: 0; }
    main > section { break-before: page; }
    main > section:first-child { break-before: auto; }
    figure img { max-height: 410px; width: auto; max-width: 100%; margin-inline: auto; }
    main p, main li:not(.manual-step), main dl > div { break-inside: avoid; }
  }`,
  });
  await page.pdf({
    path: 'public/manual/vehicle-manual.pdf',
    format: 'A4',
    printBackground: true,
    margin: { top: '12mm', bottom: '15mm', left: '12mm', right: '12mm' },
    displayHeaderFooter: true,
    headerTemplate: '<span></span>',
    footerTemplate:
      '<div style="font-size:9px;width:100%;text-align:center;color:#64748b"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
  });
} finally {
  await browser.close();
}
