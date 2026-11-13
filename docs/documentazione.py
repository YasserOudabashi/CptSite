"""Documentazione del progetto CptSite — rigenera Documentazione_CptSite.docx.

Come si usa: aggiornare i testi in SEZIONI (e AGGIORNATO_AL), poi rilanciare:

    python docs/documentazione.py

Lo script rigenera sempre il docx da zero (idempotente). Le righe che iniziano
con "- " diventano elenchi puntati; le righe vuote separano i paragrafi.
"""
from pathlib import Path

from docx import Document
from docx.shared import Pt, RGBColor

PROGETTO = "CptSite"
AGGIORNATO_AL = "13.11.2026"  # data ultimo aggiornamento, formato GG.MM.AAAA

# Le 5 sezioni fisse della documentazione. Testo discorsivo, righe "- " = bullet.
SEZIONI = {
    "Come funziona": """Sito per le Giornate Autogestite (GA), poi Assemblea paritetica, Eco Comitato e tornei del CPT Trevano. Node.js + TypeScript con Express e PostgreSQL, in un container Docker.
- Utenti, ruoli multipli (i permessi si sommano) e anni scolastici separati.
- Registrazione allievi: ID + codice generale, poi codice personale via mail e scelta della password (hash scrypt). Docenti e relatori entrano solo con link d'invito monouso.
- Login con sessioni lato server, blocco dopo 5 tentativi, recupero password con codice valido 30 minuti.
- Il sito manda solo tre tipi di mail (codice personale, recupero password, apertura iscrizioni); l'apertura iscrizioni va a lotti con coda nel database e limite giornaliero.
- Controllo permessi con can()/requireCan() su ogni pagina protetta; menu diverso per ruolo.
- Pagine admin: utenti e ruoli, inviti, elenco ID allievi e codice generale, impostazioni (anno, date GA, blocchi orari, QR code).""",
    "Perché funziona così": """Il sito deve vivere senza Yasser: niente servizi a pagamento, tutta la configurazione in variabili d'ambiente, un solo container + Postgres, portabile su qualunque hosting (Infomaniak o server della scuola).
- Le mail sono solo tre per non dipendere da un servizio di invio: le altre comunicazioni passano dalle caselle della scuola.
- I test usano un vero PostgreSQL (embedded-postgres) e un trasporto mail finto, così girano anche su Windows senza installare nulla.
- Lo sviluppo procede a storie (prd.json) con ralph in sandbox Docker (Sonnet 5.5), poi revisione con Fable 5.2 e test su Windows a ogni commit.""",
    "Come deployarlo": """Ancora non pubblicato: il capilab chiede di finire prima il sito (incontro del 13.11).
- Copiare .env.example in .env e compilare DATABASE_URL, SITE_URL, SMTP_* (in produzione senza SMTP_HOST il server si ferma all'avvio).
- docker compose up -d (container app + Postgres; le migrazioni partono all'avvio).
- Test: npm ci, poi npm test (66 test, ~40 s). Su Windows rifare npm ci se la sandbox Linux ha installato i node_modules.""",
    "Cosa migliorare": """Punti della revisione Fable del 12.11 (dettagli in progress.txt):
- Limite per IP di registrazione/recupero: deciso 300/ora per IP + 5/ora per persona (da implementare).
- Rate limit e blocco login non atomici con richieste parallele; blocco account provocabile da terzi.
- Protezione CSRF solo con SameSite=Lax: aggiungere controllo Origin; SITE_URL obbligatoria in produzione.
- Pulizia periodica di sessioni, tentativi falliti e codici scaduti.
- Minori: avviso al cambio anno, errori leggibili per date impossibili, pagina 403 con layout.""",
    "Prossimi punti": """- Fase 2 del sito: attività GA (US-014–019) con ralph, poi revisione.
- Applicare il nuovo limite per IP e i punti della revisione.
- Finire il sito entro fine novembre 2026, poi ricontattare il capilab per la pubblicazione.
- PDF automatici (PRD in 006_PRD/prd-documenti-pdf.md) insieme alle storie collegate.
- Date GA da proporre alla direzione: 5-6-7 aprile oppure 19-20-21 aprile 2027 (mai di venerdì); evitare 13-14 aprile (Liceo 3).
- Raccogliere le risposte del sondaggio "Proponi un'attività o un relatore" e il modulo Word delle proposte.""",
}

BLU = RGBColor(0x1A, 0x23, 0x7E)
OUTPUT = Path(__file__).parent / f"Documentazione_{PROGETTO}.docx"


def _p(doc, testo, *, bold=False, size=None, color=None):
    par = doc.add_paragraph()
    run = par.add_run(testo)
    run.bold = bold
    if size:
        run.font.size = Pt(size)
    if color:
        run.font.color.rgb = color
    return par


def _corpo(doc, testo):
    """Rende un blocco di testo: bullet per righe '- ', paragrafi per il resto."""
    for riga in [r.strip() for r in testo.strip().splitlines()]:
        if not riga:
            continue
        if riga.startswith("- "):
            doc.add_paragraph(riga[2:], style="List Bullet")
        else:
            doc.add_paragraph(riga)


def genera():
    doc = Document()
    _p(doc, f"Documentazione — {PROGETTO}", bold=True, size=16, color=BLU)
    _p(doc, f"Aggiornata al: {AGGIORNATO_AL}", size=10)
    for titolo, testo in SEZIONI.items():
        _p(doc, titolo, bold=True, size=13, color=BLU)
        if testo.strip():
            _corpo(doc, testo)
        else:
            _p(doc, "(da compilare)")
    doc.save(OUTPUT)
    return OUTPUT


if __name__ == "__main__":
    percorso = genera()
    assert percorso.exists() and percorso.stat().st_size > 0, "docx non generato"
    print(f"OK — generato {percorso}")
