# Sito GA / Assemblea paritetica / Eco Comitato — CPT Trevano (SAM)

Sito in tempo reale per gestire le Giornate Autogestite (GA), poi Assemblea paritetica ed Eco Comitato. Autore: Yasser Oudabashi (presidente dell'Assemblea paritetica del CPT Trevano; tutto il lavoro è per il CPT). Il Lilu2 è un'altra scuola: lo usiamo solo come esempio e come fonte dei contatti dei relatori.

## Stato
Sito: tutte le 39 storie (Fasi 1-6: fondamenta, attività GA, iscrizioni, presenze e gestione, anni e Home, tornei) implementate e controllate al 24.11.2026 (sviluppo Sonnet 5.5, controlli Opus 5.5 perché Fable 5.2 chiedeva crediti), correzioni e giro di sicurezza fatti (CSRF Origin, limite 300/ora per IP + 5/ora per persona, pulizia periodica, mail di apertura una sola volta). Test su Windows: `npm ci` poi `npm test` (200 test). MANCA: verifica nel browser di tutte le pagine e pubblicazione (capilab). Punti minori aperti in `progress.txt`. (Regola d'oro sull'analisi del sito Lilu2 rimossa il 15.10: non serve più.) Copie dei file sorgente nelle cartelle sotto (originali in `D:\003-School\001-Samt\zDocumenti\`).

## Mappa cartelle
- `GA/` — tabella proposte (`01._tabella-autogestite-finale-CSIA.xlsx`, ~215 righe), `Excel generale.xlsx` (orari + attività + numero allievi), `GA.docx` (to-do e attività).
- `EcoComitato/` contiene anche `OrdiniDelGiorno/` (convocazioni e ODG) e `Bandi/`; i verbali Eco scaricati da Outlook vanno in `EcoComitato/Verbali/`.
- `006_PRD/prd-documenti-pdf.md` — PDF automatici (PDF-001–031).
- `Assemblea/` — `PreAssemblea_2026-2027/` (temi riunione), `Seconda_Assemblea_2025-2026/` (argomenti, presenze, verbale 22.04, modello verbale).
- `EcoComitato/` — `Verbali/` (31.03, 28.04, allegato Cittadinanza), `Sondaggi/` (SpazioAutogestito docx/xlsx/report, 100 risposte).
- `Presentazione/` — PowerPoint per la riunione Eco del 23.10.2026 (come funziona il sito: GA, tornei, Eco). `EcoComitato/Spazio/` — Regolamento e Organigramma COMPILATI (proposte evidenziate in giallo). `Bozza_Sito/index.html` — bozza cliccabile con le pagine Eco.
- `Capilab/` — preparazione incontri con l'ufficio capilab (`Incontro_capilab_2026-10-30.docx`: cosa spiegare, domande, tabella risposte).
- `Docenti/` — documenti da dare ai docenti (domande su server, login, privacy).

## Dati chiave dai file
- Orari GA (da `GA/GA.docx`, confermati): 8:30-10:00, 10:15-11:45, pranzo 11:45-12:45, 12:45-14:15, 14:30-16:00. Date delle GA: ancora da decidere (Yasser).
- Allievi: ~328 sicuri / ~337 con eventuali (Chimica 38, Disegno 73+9, Informatica 71, Elettronica 146). Numero MOMENTANEO.
- Attività: quelle in `GA.docx` vanno richieste agli allievi per sapere se le fanno ancora.
- Analisi EcoSpazio (mockup statico del Prof. Moscatelli per l'Eco Comitato, preso come esempio UX: home, prenota spazio, bacheca, proposte votabili/anonime, info) in `Analisi_EcoSpazio/`. Le 7 fasi Eco-Schools si gestiscono su app.ecoschools-ch.org: noi mettiamo solo il link. Deciso 08.10: EcoSpazio resta separato (solo link) · proposte anonime per tutti tranne admin · bacheca con avvisi + commenti moderati · prenotazione spazio: da decidere.
- Analisi Lilu2 (150 attività, relatori, contatti, confronto requisiti) in `Analisi_Lilu2/`. Relatori NON ancora contattati: si contattano a requisiti chiusi e sito GA pronto. Bozze mail personalizzate (una per relatore, da inviare a mano) in `Analisi_Lilu2/Mail_relatori.docx`. L'associazione di Kamil (combattimento medievale) è in `relatori_DA_CONTATTARE.xlsx`: la contatta Yasser.
- Attività: titolo, descrizione, fascia oraria, durata, aula, max partecipanti, relatore (nome/telefono), materiale, docente/classe.
- Verbali: righe con sigla I/C/D/E (Informazione, Compito, Decisione, Elaborazione), responsabile, termine; presenti/scusati divisi docenti/allievi/direzione.
- Eco Comitato: riunioni numerate, ruoli numerati per membro, verbalista a rotazione.

## Stack provvisorio (da confermare)
Vincoli: nessuna API a pagamento/personale (il sito deve vivere senza Yasser); hosting su Infomaniak.
- Node.js + TypeScript, un container Docker + PostgreSQL.
- Tempo reale: WebSocket/SSE con Postgres LISTEN/NOTIFY.
- Mail: 3 caselle Outlook solo in ricezione; il sito non invia.
- Estrazione info dalle mail: regole e pattern deterministici (regex, parole chiave, campi strutturati nei modelli di mail inviati). Niente AI esterna. Dati in tabelle filtrabili, export CSV/XLSX, dato correggibile a mano con link alla mail d'origine.

## Ruoli (bozza)
Admin · Organizzatore GA · Docente · Allievo · Relatore (esterno) · Membro Eco Comitato · Membro Assemblea/Commissione · Direzione. Matrice permessi da definire insieme a Yasser (non chiederla alla direzione).
- Dal sito Yasser assegna i ruoli alle persone. Una persona può avere più ruoli: i permessi si sommano (unione) e vanno gestite bene le sovrapposizioni/conflitti (es. allievo + organizzatore, docente + membro Assemblea).

## Tornei (decisione 22.10)
Niente "torneo di calcio": il sito gestisce più tornei di sport diversi, con tutto ciò che serve a organizzarli bene (squadre, gironi/eliminazione, campi, orari, arbitri, risultati, classifiche, tabellone). Ruoli: Resp. tornei, Organizzatore torneo, Arbitro. Risultati: solo arbitri e organizzatori del torneo. Anche gli organizzatori GA possono creare un torneo per la propria attività. Vedi PRD Fase 6 (US-031–039).

## Seconda assemblea
Il file dove mettere tutto ciò che riguarda la seconda assemblea (proposte, aggiornamenti, punti da portare) è `Assemblea/2026-2027/Prossima_Assemblea_Proposte_e_Aggiornamenti.docx`: aggiornare quello, non creare file nuovi.

## Fasi
1. GA (attività, relatori/mail, iscrizioni allievi con posti in tempo reale, aule/orari, ruoli).
2. Assemblea paritetica (ordine del giorno, presenze, verbale I/C/D/E, azioni).
3. Eco Comitato (Spazio, regolamento, turni gestori, attività, riunioni/verbali, sondaggi): PRD in `006_PRD/prd-eco-comitato.md` (ECO-001–022), scritto il 22.10 per la presentazione del 23.10.
4. Tornei (nel PRD attuale come Fase 6).

## Spunti da aggiungere al sito (da discutere con Yasser: come, cosa, ruoli)
- **Festa di fine anno** (verbale Assemblea 06.10.2026): gestirla dal sito. Data da fissare al più presto e budget da chiedere alla scuola. Feedback dalla festa dell'anno scorso: più attività, un posto migliore per la musica (l'anno scorso si stava sotto la stecca del sole), più tavoli.
- **Sondaggio regolamento abbigliamento**: un voto per ogni capo, poi le statistiche. Bozza in `Assemblea/2026-2027/Regolamento_abbigliamento_BOZZA.docx`.

## Decisioni riunione GA (22.10)
Verbale e compiti in `GA/Riunione_GA_1_2026-10-22.docx`. Orari definitivi confermati. Torneo di calcio come extra fuori orario. Aula lettura (chiedere a un docente). Sito: prima/seconda scelta di blocco, attività su più blocchi, ripetibile 2 volte, richiesta materiali, pulsante "Apri le iscrizioni" che manda una mail a tutti allievi e docenti (quindi il sito invia TRE tipi di mail), QR code del sito. Budget (vicedirettore Peretti): importo non noto; acquisti grandi da grandi aziende = preventivo e paga la scuola, acquisti piccoli (Migros, Lidl) = paghiamo noi e ci rimborsano. Tutte le richieste alla direzione le fa Yasser. QR code: si genera quando il sito è online. Aperti: buvette/regali relatori, info point, invito all'esercito (Yasser chiede alla direzione).

## Capilab / informatica scuola (25.10)
- Contatti: Ingrid Cereda e PaPo (ufficio capilab). Lista di distribuzione paritetica@samtrevano.ch aggiornata da Ingrid con l'Excel del 15.10 (+2 allievi).
- Pubblicazione: capilab dice di **finire prima il sito** e poi ricontattarli (hosting e indirizzo si decidono dopo).
- Incontro capilab: NON ancora fatto (né 30.10 né 13.11): da fissare. Cartella pronta: `Capilab/Incontro_capilab_2026-11-13/` (spiegazione con tabella risposte, documenti precedenti, demo). Yasser porta il PC.
- Caselle GA/Eco e gruppi docenti/allievi con permesso d'invio: da spiegare a voce in ufficio capilab (13.11). Le caselle saranno sul dominio samtrevano.ch (non Outlook.com): se i gruppi esistono, la mail di apertura iscrizioni è una sola mail per gruppo.

## Decisioni prese (15.10)
- **Login/registrazione**: l'allievo inserisce il proprio ID + un codice generale (uguale per tutti) → il sito gli invia via mail un codice personale (per distinguerlo dagli altri) → inserito il codice personale sceglie la password (salvata hashata). Ruolo base = Allievo: può solo iscriversi alle GA o iscriversi per andare nell'aula dell'Eco Comitato.
- **Mail**: 3 indirizzi Outlook nuovi (GA, Eco Comitato, Assemblea) che ricevono. Il sito invia SOLO tre mail: codice personale di registrazione, recupero password e (dal 22.10) apertura delle iscrizioni GA. Tutte le altre (relatori, avvisi) le manda Claude via Claude in Chrome su richiesta di Yasser. Yasser = Responsabile sito (fa tutto). Matrice permessi: `Matrice_Permessi_BOZZA.md` (ruoli base + ruoli che aggiungono, nessun conflitto).
- **Pagine/ruoli**: bozza in `Bozza_Pagine_e_Ruoli.md`. Blocchi orari modificabili dal sito (da decidere). Approvazione attività solo Responsabile GA (più persone); Direzione fuori dal sito. Aula Eco aperta/chiusa a mano. Bacheca moderata dal Resp. sito. Chat e bacheca/proposte anonime rimandate all'ultima fase. Docente/relatore in registrazione = Allievo finché confermato.
- **Hosting**: ipotesi Infomaniak, NON confermato: il progetto resta portabile (Docker, config in variabili d'ambiente). Docenti e relatori si registrano solo con link d'invito creato da Yasser (porta già il ruolo); gli allievi con ID (mail scolastica) + codice generale.
- **Privacy (nLPD)**: approvata dalla direzione, la gestiscono loro.
- **Date GA**: Yasser decide oggi, dopo le 17. **Conteggio allievi**: dopo.
- **Matrice permessi**: da fare dopo la bozza delle pagine del sito (Claude propone, Yasser conferma le pagine, poi si definiscono ruoli e permessi).

## Decisioni prese (12.11)
- **PDF automatici**: tutti i 30 proposti, generati dal server con un solo modello (logo e intestazione CPT Trevano, spazio firma, protocollo e data), archiviati con versioni; non si inviano per mail. PRD: `006_PRD/prd-documenti-pdf.md`.
- **Aula Eco**: le richieste le può accettare ogni membro dell'Eco Comitato; la notifica (nel sito) va soprattutto al Gestore di turno. PDF di richiesta e accettazione: ECO-010b.
- **Date**: Liceo 3 fa le GA il 13–14 aprile 2027 (da evitare). Altri licei: li porta Aline. Seconda Assemblea: sondaggio → giovedì 10.12.2026 (7 voti su 11).
- **Sondaggio abbigliamento**: 120 risposte, risultati in `Assemblea/2026-2027/Prossima_Assemblea_Proposte_e_Aggiornamenti.docx` (punto 3). Elettronica quasi assente (2 risposte).
- **Regali relatori**: decide il gruppo GA. **Aula lettura**: la chiede Yasser.
- **Outlook (ssl586)**: cartelle Eco Comitato, Assemblea paritetica, GA, Capilab, Direzione, Scuola - lezioni e docenti, Newsletter e avvisi, fcj894 (amico). Push su GitHub dopo ogni controllo che passa.

## Decisioni e appunti (12–13.11)
- **Limite per IP** di registrazione/recupero password: 300/ora per IP + 5/ora per persona (implementato).
- **Data GA approvata: mercoledì 21 aprile 2027** (un giorno). Altri licei: Liceo 1 23–24.3 · Liceo 2 12–13.4 · Liceo 3 13–14.4 · Liceo Belli 8–10.3 (da confermare) · Liceo Mendrisio 15–16.3 · Liceo Locarno 22–23.3 · SCC Belli 15–16.3 (o solo 15). Nessuna sovrapposizione.
- Chiedere in che giorno sono le giornate sportive (se non c'è la settimana bianca).
- **Nicola** vuole occuparsi dell'assegnazione delle aule alle attività.
- **Esercito**: contatto Fiorenzo Pichler, +41 58 460 71 15 / +41 79 366 32 95, fiorenzo.pichler@vtg.admin.ch (da verificare il formato della mail).
- **Sito da finire entro fine novembre 2026.**
- Sondaggi (19.11): report in `Assemblea/2026-2027/Report_sondaggi_2026-11-19.html`. Abbigliamento: Elettronica non si riapre, i dati bastano. Proposte attività: 2 (Unihockey, Macramè). Seconda Assemblea fissata giovedì 10.12.2026, nuovi argomenti entro giovedì 3.12; bozza mail a paritetica@samtrevano.ch preparata in Outlook (con allegato il docx della prossima assemblea).
- Festa di fine anno: promemoria nel calendario Google il 4 febbraio 2027.
- Proposte attività: modulo Word `GA/Proposta_attivita_GA_2027.docx` e sondaggio Forms "GA 2027 – Proponi un'attività o un relatore" (inviato agli allievi il 12.11).
- Documentazione: `docs/documentazione.py` → `docs/Documentazione_CptSite.docx`; diario: `diario.py` → `DIARIO_CptSite.docx`.

## Decisioni aperte
Prenotazione spazio Eco Comitato · account Infomaniak · indirizzi 3 caselle · nome del sito. (Date GA, conteggio allievi ed elenco ID NON bloccano il sito: si inseriscono dal sito quando noti, 22.10.)

## Regole di lavoro
- Domande prima di implementare (AskUserQuestion).
- Ponytail: soluzione minima che funziona.
- A specifiche chiuse: lanciare la skill `graphify` sulla cartella.
- Fine sessione: `/chiudi-lavoro`.
