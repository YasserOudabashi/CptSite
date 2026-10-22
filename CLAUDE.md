# Sito GA / Assemblea paritetica / Eco Comitato — CPT Trevano (SAM)

Sito in tempo reale per gestire le Giornate Autogestite (GA), poi Assemblea paritetica ed Eco Comitato. Autore: Yasser Oudabashi (presidente dell'Assemblea paritetica del CPT Trevano; tutto il lavoro è per il CPT). Il Lilu2 è un'altra scuola: lo usiamo solo come esempio e come fonte dei contatti dei relatori.

## Stato
Fase specifiche. Nessun codice. (Regola d'oro sull'analisi del sito Lilu2 rimossa il 15.10: non serve più.) Copie dei file sorgente nelle cartelle sotto (originali in `D:\003-School\001-Samt\zDocumenti\`).

## Mappa cartelle
- `GA/` — tabella proposte (`01._tabella-autogestite-finale-CSIA.xlsx`, ~215 righe), `Excel generale.xlsx` (orari + attività + numero allievi), `GA.docx` (to-do e attività).
- `Assemblea/` — `PreAssemblea_2026-2027/` (temi riunione), `Seconda_Assemblea_2025-2026/` (argomenti, presenze, verbale 22.04, modello verbale).
- `EcoComitato/` — `Verbali/` (31.03, 28.04, allegato Cittadinanza), `Sondaggi/` (SpazioAutogestito docx/xlsx/report, 100 risposte).
- `Presentazione/` — PowerPoint per la riunione Eco del 23.10.2026 (come funziona il sito: GA, tornei, Eco). `EcoComitato/Spazio/` — Regolamento e Organigramma COMPILATI (proposte evidenziate in giallo). `Bozza_Sito/index.html` — bozza cliccabile con le pagine Eco.
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

## Decisioni prese (15.10)
- **Login/registrazione**: l'allievo inserisce il proprio ID + un codice generale (uguale per tutti) → il sito gli invia via mail un codice personale (per distinguerlo dagli altri) → inserito il codice personale sceglie la password (salvata hashata). Ruolo base = Allievo: può solo iscriversi alle GA o iscriversi per andare nell'aula dell'Eco Comitato.
- **Mail**: 3 indirizzi Outlook nuovi (GA, Eco Comitato, Assemblea) che ricevono. Il sito invia SOLO due mail: codice personale di registrazione e recupero password. Tutte le altre (relatori, avvisi) le manda Claude via Claude in Chrome su richiesta di Yasser. Yasser = Responsabile sito (fa tutto). Matrice permessi: `Matrice_Permessi_BOZZA.md` (ruoli base + ruoli che aggiungono, nessun conflitto).
- **Pagine/ruoli**: bozza in `Bozza_Pagine_e_Ruoli.md`. Blocchi orari modificabili dal sito (da decidere). Approvazione attività solo Responsabile GA (più persone); Direzione fuori dal sito. Aula Eco aperta/chiusa a mano. Bacheca moderata dal Resp. sito. Chat e bacheca/proposte anonime rimandate all'ultima fase. Docente/relatore in registrazione = Allievo finché confermato.
- **Hosting**: ipotesi Infomaniak, NON confermato: il progetto resta portabile (Docker, config in variabili d'ambiente). Docenti e relatori si registrano solo con link d'invito creato da Yasser (porta già il ruolo); gli allievi con ID (mail scolastica) + codice generale.
- **Privacy (nLPD)**: approvata dalla direzione, la gestiscono loro.
- **Date GA**: Yasser decide oggi, dopo le 17. **Conteggio allievi**: dopo.
- **Matrice permessi**: da fare dopo la bozza delle pagine del sito (Claude propone, Yasser conferma le pagine, poi si definiscono ruoli e permessi).

## Decisioni aperte
Prenotazione spazio Eco Comitato · account Infomaniak · indirizzi 3 caselle · nome del sito. (Date GA, conteggio allievi ed elenco ID NON bloccano il sito: si inseriscono dal sito quando noti, 22.10.)

## Regole di lavoro
- Domande prima di implementare (AskUserQuestion).
- Ponytail: soluzione minima che funziona.
- A specifiche chiuse: lanciare la skill `graphify` sulla cartella.
- Fine sessione: `/chiudi-lavoro`.
