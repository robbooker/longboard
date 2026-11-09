// #385 Reader browser test fixtures, made here in memory: a tiny EPUB of Aesop's fables (public
// domain, from the 1867 George Fyler Townsend translation) and a tiny three-page PDF. The EPUB also
// carries a script, an inline event handler and a javascript: link, to prove none of them run.
import JSZip from 'jszip';
import sharp from 'sharp';

// The EPUB's cover image: a plain drawn cover with the title.
export const COVER_PNG = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600">
  <rect width="400" height="600" fill="#2f4a3a"/><rect x="24" y="24" width="352" height="552" fill="none" stroke="#e8d9a8" stroke-width="3"/>
  <text x="200" y="230" text-anchor="middle" font-family="serif" font-size="40" fill="#f3ead2">Three Fables</text>
  <text x="200" y="285" text-anchor="middle" font-family="serif" font-size="40" fill="#f3ead2">of Aesop</text>
  <text x="200" y="470" text-anchor="middle" font-family="serif" font-size="24" fill="#e8d9a8">AESOP</text></svg>`)).png().toBuffer();

const FABLES = [
  ['The Wolf and the Lamb', 'Wolf, meeting with a Lamb astray from the fold, resolved not to lay violent hands on him, but to find some plea to justify to the Lamb the Wolf’s right to eat him. He thus addressed him: “Sirrah, last year you grossly insulted me.” “Indeed,” bleated the Lamb in a mournful tone of voice, “I was not then born.” Then said the Wolf, “You feed in my pasture.” “No, good sir,” replied the Lamb, “I have not yet tasted grass.” Again said the Wolf, “You drink of my well.” “No,” exclaimed the Lamb, “I never yet drank water, for as yet my mother’s milk is both food and drink to me.” Upon which the Wolf seized him and ate him up, saying, “Well! I won’t remain supperless, even though you refute every one of my imputations.” The tyrant will always find a pretext for his tyranny.'],
  ['The Hare and the Tortoise', 'A Hare one day ridiculed the short feet and slow pace of the Tortoise, who replied, laughing: “Though you be swift as the wind, I will beat you in a race.” The Hare, believing her assertion to be simply impossible, assented to the proposal; and they agreed that the Fox should choose the course and fix the goal. On the day appointed for the race the two started together. The Tortoise never for a moment stopped, but went on with a slow but steady pace straight to the end of the course. The Hare, lying down by the wayside, fell fast asleep. At last waking up, and moving as fast as he could, he saw the Tortoise had reached the goal, and was comfortably dozing after her fatigue. Slow but steady wins the race.'],
  ['The Ant and the Grasshopper', 'In a field one summer’s day a Grasshopper was hopping about, chirping and singing to its heart’s content. An Ant passed by, bearing along with great toil an ear of corn he was taking to the nest. “Why not come and chat with me,” said the Grasshopper, “instead of toiling and moiling in that way?” “I am helping to lay up food for the winter,” said the Ant, “and recommend you to do the same.” “Why bother about winter?” said the Grasshopper; “we have got plenty of food at present.” But the Ant went on its way and continued its toil. When the winter came the Grasshopper had no food and found itself dying of hunger, while it saw the ants distributing every day corn and grain from the stores they had collected in the summer. Then the Grasshopper knew: it is best to prepare for the days of necessity.'],
];
export const EPUB_TITLE = 'Three Fables of Aesop';
export const EPUB_AUTHOR = 'Aesop';
export const CHAPTERS = FABLES.map(([title], i) => `${['I', 'II', 'III'][i]}. ${title}`);

const xhtml = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${body}</body></html>`;

export async function makeEpub() {
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const items = FABLES.map((_, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('');
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:aesop-reader-test</dc:identifier><dc:title>${EPUB_TITLE}</dc:title><dc:creator>${EPUB_AUTHOR}</dc:creator><dc:language>en</dc:language><meta property="dcterms:modified">2026-11-08T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/><item id="css" href="style.css" media-type="text/css"/>${items}</manifest>
<spine>${FABLES.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine></package>`);
  zip.file('OEBPS/nav.xhtml', xhtml('Contents', `<nav epub:type="toc"><ol>${CHAPTERS.map((t, i) => `<li><a href="c${i + 1}.xhtml">${t}</a></li>`).join('')}</ol></nav>`));
  zip.file('OEBPS/style.css', 'body { font-family: serif; } p { text-indent: 1.5em; margin: 0 0 0.6em; }');
  zip.file('OEBPS/cover.png', COVER_PNG);
  FABLES.forEach(([title, text], i) => {
    // Each fable four times, so every chapter runs over several pages.
    const paragraphs = Array.from({ length: 4 }, (_, n) => `<p id="p${n}">${text}</p>`).join('');
    const traps = i === 0
      ? `<script>window.parent.__readerPwned = 'script';</script><img src="missing.png" onerror="window.parent.__readerPwned='onerror'" alt=""/><p><a id="jslink" href="javascript:window.parent.__readerPwned='link'">a link</a></p>`
      : '';
    zip.file(`OEBPS/c${i + 1}.xhtml`, xhtml(CHAPTERS[i], `<h1>${CHAPTERS[i]}</h1>${traps}${paragraphs}`));
  });
  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' });
}

/** A three-page PDF with a big page number on each page and bookmarks for each page. */
export function makePdf(pages = 3) {
  const objects = [];
  const add = (body) => (objects.push(body), objects.length);
  const catalog = add(null), pagesObj = add(null), font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'), outlines = add(null);
  const pageIds = [], outlineIds = [];
  for (let i = 1; i <= pages; i++) {
    const text = `BT /F1 48 Tf 72 640 Td (Page ${i}) Tj ET BT /F1 14 Tf 72 600 Td (Longboard System Bible test page ${i} of ${pages}.) Tj ET`;
    const content = add(`<< /Length ${text.length} >>\nstream\n${text}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  for (let i = 0; i < pages; i++) outlineIds.push(add(null));
  outlineIds.forEach((id, i) => {
    objects[id - 1] = `<< /Title (Section ${i + 1}) /Parent ${outlines} 0 R ${i ? `/Prev ${outlineIds[i - 1]} 0 R ` : ''}${i < pages - 1 ? `/Next ${outlineIds[i + 1]} 0 R ` : ''}/Dest [${pageIds[i]} 0 R /Fit] >>`;
  });
  objects[outlines - 1] = `<< /Type /Outlines /First ${outlineIds[0]} 0 R /Last ${outlineIds.at(-1)} 0 R /Count ${pages} >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages} >>`;
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R /Outlines ${outlines} 0 R >>`;
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}
