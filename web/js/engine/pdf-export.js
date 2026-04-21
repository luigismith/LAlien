/**
 * pdf-export.js -- "Reliquia" PDF export.
 *
 * Opens a new window with a hand-styled parchment document that prints
 * beautifully via the browser's Print dialog (Save as PDF on macOS/Windows,
 * Share → Save as PDF on iOS). No external library — we build HTML and let
 * the browser render it.
 *
 * Exports:
 *   exportLivePet({pet, diary, vocabularyCount})
 *   exportGraveyardEntry(entry)
 */

function esc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatDate(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            day: '2-digit', month: 'long', year: 'numeric'
        });
    } catch { return '—'; }
}

// Embedded CSS for the parchment look. Kept inside the template so the
// printed PDF is fully self-contained.
const PDF_STYLE = `
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
html, body {
    margin: 0;
    padding: 0;
    font-family: 'Georgia', 'Cormorant Garamond', serif;
    color: #2A1E10;
    background: #F3EAD7;
}
.relic {
    max-width: 170mm;
    margin: 0 auto;
    padding: 10mm 2mm;
}
.relic-header {
    text-align: center;
    border-bottom: 2px solid #8C6A2A;
    padding-bottom: 6mm;
    margin-bottom: 8mm;
}
.relic-seal {
    font-size: 12px;
    letter-spacing: 0.35em;
    color: #8C6A2A;
    text-transform: uppercase;
    margin-bottom: 4mm;
}
.relic-name {
    font-size: 34pt;
    font-weight: bold;
    color: #3A2614;
    letter-spacing: 0.02em;
    line-height: 1.1;
    margin: 2mm 0 3mm;
    font-variant: small-caps;
}
.relic-subtitle {
    font-size: 12pt;
    color: #6E5A38;
    font-style: italic;
}
.relic-meta {
    display: flex;
    justify-content: space-between;
    font-size: 10pt;
    color: #5A4020;
    margin: 6mm 0 8mm;
    padding: 4mm 0;
    border-top: 1px solid #C8B78E;
    border-bottom: 1px solid #C8B78E;
}
.relic-meta-item { flex: 1; }
.relic-meta-label {
    font-size: 8pt;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: #8C6A2A;
    margin-bottom: 1mm;
}
.relic-section {
    margin-bottom: 10mm;
    page-break-inside: avoid;
}
.relic-section-title {
    font-size: 14pt;
    color: #3A2614;
    margin-bottom: 4mm;
    padding-bottom: 2mm;
    border-bottom: 1px dotted #8C6A2A;
    font-variant: small-caps;
    letter-spacing: 0.1em;
}
.relic-epitaph {
    background: rgba(140, 106, 42, 0.08);
    border-left: 3px solid #8C6A2A;
    padding: 5mm 6mm;
    font-style: italic;
    font-size: 12pt;
    line-height: 1.7;
    color: #3A2614;
    white-space: pre-wrap;
    quotes: "«" "»" "\\201C" "\\201D";
}
.relic-epitaph::before { content: open-quote; font-size: 28pt; line-height: 0; vertical-align: -0.3em; color: #8C6A2A; margin-right: 2mm; }
.relic-epitaph::after  { content: close-quote; font-size: 28pt; line-height: 0; vertical-align: -0.3em; color: #8C6A2A; margin-left: 2mm; }
.relic-diary-entry {
    margin-bottom: 6mm;
    page-break-inside: avoid;
}
.relic-diary-date {
    font-size: 9pt;
    color: #8C6A2A;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    margin-bottom: 1.5mm;
}
.relic-diary-text {
    font-size: 11pt;
    line-height: 1.65;
    color: #2A1E10;
}
.relic-footer {
    margin-top: 14mm;
    padding-top: 4mm;
    border-top: 1px solid #C8B78E;
    text-align: center;
    font-size: 9pt;
    color: #6E5A38;
    font-style: italic;
}
.relic-polaroid-strip {
    display: flex;
    gap: 4mm;
    justify-content: center;
    flex-wrap: wrap;
    margin: 4mm 0;
}
.relic-polaroid {
    background: #FFF;
    padding: 2mm 2mm 5mm;
    box-shadow: 0 1pt 3pt rgba(0,0,0,0.25);
    text-align: center;
    width: 38mm;
}
.relic-polaroid img {
    width: 100%;
    image-rendering: pixelated;
    border: 1px solid #8C6A2A;
    display: block;
}
.relic-polaroid-caption {
    font-size: 7pt;
    color: #2A1E10;
    margin-top: 1.5mm;
    line-height: 1.3;
}
.relic-empty {
    text-align: center;
    color: #8C6A2A;
    font-style: italic;
    padding: 8mm;
}
@media print {
    .no-print { display: none !important; }
}
.print-btn {
    position: fixed;
    top: 10px; right: 10px;
    padding: 8px 14px;
    background: #3A2614;
    color: #F3EAD7;
    border: none;
    border-radius: 4px;
    font-size: 13px;
    cursor: pointer;
    box-shadow: 0 2px 6px rgba(0,0,0,0.2);
}
.print-btn:hover { background: #5A3A22; }
`;

function buildDocument({ name, stageName, ageDays, birthDate, deathDate, vocabSize, transcended, lastWords, diary, polaroids }) {
    const title = `Reliquia — ${name || 'Lalìen'}`;
    const today = new Date().toLocaleDateString(undefined, { day: '2-digit', month: 'long', year: 'numeric' });
    const diaryEntries = (diary && diary.length) ? diary.slice().reverse() : [];

    const epitaphHTML = lastWords
        ? `<section class="relic-section">
               <h2 class="relic-section-title">${transcended ? 'Canto finale · Trascendenza' : 'Ultime parole'}</h2>
               <blockquote class="relic-epitaph">${esc(lastWords)}</blockquote>
           </section>`
        : '';

    const polaroidsHTML = (polaroids && polaroids.length)
        ? `<section class="relic-section">
               <h2 class="relic-section-title">Polaroid del Cosmo</h2>
               <div class="relic-polaroid-strip">
                   ${polaroids.slice(0, 8).map(p => `
                       <div class="relic-polaroid">
                           <img src="${esc(p.dataUrl)}" alt="">
                           <div class="relic-polaroid-caption">${esc(p.caption || '')}</div>
                       </div>
                   `).join('')}
               </div>
           </section>`
        : '';

    const diaryHTML = diaryEntries.length
        ? `<section class="relic-section">
               <h2 class="relic-section-title">Diario (${diaryEntries.length} voci)</h2>
               ${diaryEntries.map(e => `
                   <article class="relic-diary-entry">
                       <div class="relic-diary-date">Giorno ${esc(e.day ?? '?')} · ${esc(e.stageName || '')}</div>
                       <div class="relic-diary-text">${esc(e.text || '')}</div>
                   </article>
               `).join('')}
           </section>`
        : `<section class="relic-section">
               <h2 class="relic-section-title">Diario</h2>
               <p class="relic-empty">Nessuna voce ancora scritta.</p>
           </section>`;

    return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>${esc(title)}</title>
<style>${PDF_STYLE}</style>
</head>
<body>
<button class="no-print print-btn" onclick="window.print()">📄 Stampa / Salva come PDF</button>
<div class="relic">
    <header class="relic-header">
        <div class="relic-seal">✦ Reliquia ✦ Lalìen Companion ✦</div>
        <h1 class="relic-name">${esc(name || 'Syrma senza nome')}</h1>
        <div class="relic-subtitle">${esc(stageName || '')}${transcended ? ' · trascendente' : ''}</div>
    </header>

    <div class="relic-meta">
        <div class="relic-meta-item">
            <div class="relic-meta-label">Nato</div>
            <div>${esc(birthDate || '—')}</div>
        </div>
        <div class="relic-meta-item">
            <div class="relic-meta-label">${deathDate ? 'Tornato al canto' : 'Vivente'}</div>
            <div>${esc(deathDate || 'ancora con il suo custode')}</div>
        </div>
        <div class="relic-meta-item">
            <div class="relic-meta-label">Vita</div>
            <div>${esc(ageDays != null ? ageDays + ' giorni' : '—')}</div>
        </div>
        <div class="relic-meta-item">
            <div class="relic-meta-label">Lessico</div>
            <div>${esc(vocabSize != null ? vocabSize + ' parole' : '—')}</div>
        </div>
    </div>

    ${epitaphHTML}
    ${polaroidsHTML}
    ${diaryHTML}

    <footer class="relic-footer">
        Reliquia redatta il ${esc(today)} · Lalìen Companion
    </footer>
</div>
<script>
    // Auto-trigger the print dialog after assets settle, so the user lands
    // straight in Save-as-PDF on most platforms.
    setTimeout(() => { try { window.print(); } catch (_) {} }, 400);
</script>
</body>
</html>`;
}

function openAndPrint(htmlString, titleHint) {
    const win = window.open('', '_blank');
    if (!win) {
        alert('Non riesco ad aprire la finestra PDF — consenti i pop-up per questo sito.');
        return false;
    }
    win.document.open();
    win.document.write(htmlString);
    win.document.close();
    if (titleHint) {
        try { win.document.title = titleHint; } catch (_) {}
    }
    return true;
}

export const PdfExport = {
    /** Export the currently-alive pet's diary + (if any) epitaph. */
    async exportLivePet({ pet, diary, vocabularyCount, relics }) {
        const data = {
            name: pet && pet.getName ? pet.getName() : '',
            stageName: pet && pet.getStageName ? pet.getStageName() : '',
            ageDays: pet && pet.getAgeDays ? pet.getAgeDays() : null,
            birthDate: pet && pet.birthTimestamp
                ? formatDate(new Date(pet.birthTimestamp).toISOString())
                : null,
            deathDate: null,
            transcended: false,
            lastWords: null,
            vocabSize: vocabularyCount ?? null,
            diary: diary || [],
            polaroids: (relics && relics.polaroids) || [],
        };
        const html = buildDocument(data);
        return openAndPrint(html, `Reliquia — ${data.name || 'Lalìen'}`);
    },

    /** Export a past pet from the graveyard (lived & died). */
    async exportGraveyardEntry(entry) {
        if (!entry) return false;
        const data = {
            name: entry.name || 'Lalìen',
            stageName: entry.stageName || '',
            ageDays: entry.ageDays ?? null,
            birthDate: entry.birthAt ? formatDate(new Date(entry.birthAt).toISOString()) : null,
            deathDate: entry.deathAt ? formatDate(new Date(entry.deathAt).toISOString()) :
                       entry.ts ? formatDate(new Date(entry.ts).toISOString()) : null,
            transcended: !!entry.transcended,
            lastWords: entry.lastWords || '',
            vocabSize: entry.vocabSize ?? null,
            diary: entry.diary || [],
            polaroids: (entry.relics && entry.relics.polaroids) || [],
        };
        const html = buildDocument(data);
        return openAndPrint(html, `Reliquia — ${data.name}`);
    },
};
