"""Diario del progetto CptSite — rigenera DIARIO_CptSite.docx.

Come si usa: a ogni chiusura di lavoro AGGIUNGERE una voce in coda a VOCI
(mai riscrivere quelle esistenti), poi rilanciare:

    python diario.py

Stile: prima persona, discorsivo. Lo script rigenera sempre il docx da zero.
"""
from pathlib import Path

from docx import Document
from docx.shared import Pt, RGBColor

PROGETTO = "CptSite"

# Una voce per giornata di lavoro. Stringa vuota = "(niente da segnalare)".
VOCI = [
    {
        "data": "13.11.2026",
        "lavori": "Tra il 9 e il 13 novembre ho chiuso la Fase 1 del sito: ralph con Sonnet 5.5 ha fatto US-003–013 (mail, registrazione, login, recupero password, permessi, menu, admin, inviti, impostazioni) e io ho testato ogni commit su Windows. Fable 5.2 ha fatto la revisione: niente di critico, ho sistemato subito alcune cose e il resto è in progress.txt. In parallelo ho preparato due sondaggi su Forms (data della seconda Assemblea e abbigliamento) e ne ho analizzato i risultati, la cartella per l'incontro col capilab del 13.11, il documento delle cose da sistemare per le GA, il modulo Word e il sondaggio per proporre attività. Ho scritto il PRD dei PDF automatici e ordinato la posta di Outlook in cartelle, scaricando i verbali dell'Eco Comitato.",
        "problemi": "Su Windows --test-force-exit faceva crashare Node a fine test: tolto. I node_modules installati nella sandbox Linux non funzionano su Windows, quindi i test li faccio in una copia separata. In Outlook una mail è finita nel cestino per le scorciatoie da tastiera: recuperata.",
        "osservazioni": "Data della seconda Assemblea dal sondaggio: giovedì 10.12. Nel sondaggio abbigliamento Elettronica ha risposto quasi solo in 2. Il sito va finito entro fine novembre.",
    },
]

BLU = RGBColor(0x1A, 0x23, 0x7E)
GRIGIO = RGBColor(0x80, 0x80, 0x80)
OUTPUT = Path(__file__).parent / f"DIARIO_{PROGETTO}.docx"


def _p(doc, testo, *, bold=False, italic=False, size=None, color=None):
    par = doc.add_paragraph()
    run = par.add_run(testo)
    run.bold = bold
    run.italic = italic
    if size:
        run.font.size = Pt(size)
    if color:
        run.font.color.rgb = color
    return par


def _sezione(doc, etichetta, testo):
    par = doc.add_paragraph()
    run = par.add_run(f"{etichetta}: ")
    run.bold = True
    if testo.strip():
        par.add_run(testo.strip())
    else:
        run2 = par.add_run("(niente da segnalare)")
        run2.italic = True
        run2.font.color.rgb = GRIGIO


def genera():
    doc = Document()
    _p(doc, f"Diario di progetto — {PROGETTO}", bold=True, size=16, color=BLU)
    for voce in VOCI:
        _p(doc, voce["data"], bold=True, size=13, color=BLU)
        _sezione(doc, "1) Lavori effettuati", voce["lavori"])
        _sezione(doc, "2) Problemi riscontrati", voce["problemi"])
        _sezione(doc, "3) Eventuali osservazioni", voce["osservazioni"])
    doc.save(OUTPUT)
    return OUTPUT


if __name__ == "__main__":
    percorso = genera()
    assert percorso.exists() and percorso.stat().st_size > 0, "docx non generato"
    print(f"OK — generato {percorso}")
