# PRD — Documenti PDF automatici

Decisione di Yasser del 12.11.2026 (modulo `Decisioni_da_prendere.html`): **tutti e 30 i PDF proposti sono voluti**, generati dal server con **un solo modello grafico**, con **logo e intestazione CPT Trevano**, **spazio per la firma** e **numero di protocollo e data**.

## 1. Regole comuni

- FR-P1: Ogni PDF passa da un unico modulo (`src/pdf/`): stesso modello, stessa intestazione, piè di pagina con protocollo, data di creazione e "pagina X di Y".
- FR-P2: Il protocollo è unico e progressivo per anno scolastico e tipo di documento (es. `ECO-RIC-2026-0007`), assegnato dal database in transazione.
- FR-P3: Ogni PDF generato si archivia (file + riga in tabella `documents`: tipo, protocollo, oggetto collegato, versione, chi, quando). Rigenerare dopo una modifica crea una nuova versione; le vecchie restano scaricabili.
- FR-P4: Il PDF si scarica solo da chi può vedere l'oggetto collegato (stessi permessi della pagina, `requireCan`).
- FR-P5: Il sito NON invia i PDF per mail (resta il limite delle tre mail): si scaricano dal sito e chi vuole li allega a mano.
- FR-P6: Libreria di generazione: una sola, gratuita, senza servizi esterni (es. `pdfkit`), font incorporati per accenti italiani.
- FR-P7: Firma: riquadro "Firma" con nome e ruolo previsti; nessuna firma digitale.

## 2. Storie

### PDF-001: Modulo PDF condiviso
**Description:** As a developer, I need one PDF module so that every document has the same look and is archived.
- [ ] `renderPdf(tipo, dati)` produce un PDF con logo CPT Trevano, intestazione, titolo, corpo, riquadri firma, piè di pagina con protocollo e data
- [ ] Logo e intestazione in un file di configurazione/asset sostituibile senza toccare il codice
- [ ] Tabella `documents` + numerazione protocollo per anno e tipo (FR-P2), versioni (FR-P3)
- [ ] Route di download con controllo permessi (FR-P4)
- [ ] Test: due PDF dello stesso tipo hanno protocolli consecutivi; una rigenerazione crea la versione 2 e la 1 resta; utente senza permesso → 403
- [ ] Typecheck passes

### Eco Comitato
| ID | Documento | Quando si genera | Storia collegata |
|---|---|---|---|
| PDF-002 | Richiesta di uso dello Spazio (A-113) | all'invio della proposta | ECO-009, ECO-010b |
| PDF-003 | Accettazione / rifiuto della richiesta | alla decisione | ECO-010, ECO-010b |
| PDF-004 | Regolamento dello Spazio (versione approvata) | all'approvazione di una versione | ECO-005 |
| PDF-005 | Organigramma e turni dei gestori (da appendere) | a ogni modifica del piano turni | ECO-006 |
| PDF-006 | Registro di passaggio consegne | a fine turno | ECO-007 |
| PDF-007 | Segnalazione / sospensione dell'accesso | alla decisione di sospensione | ECO-008 |
| PDF-008 | Lista materiali / richiesta d'acquisto (con totale) | su richiesta | ECO-013 |
| PDF-009 | Convocazione e ordine del giorno | alla creazione della riunione | ECO-015 |
| PDF-010 | Verbale con righe I/C/D/E | alla chiusura del verbale | ECO-016 |
| PDF-011 | Risultati sondaggio (report) | alla chiusura del sondaggio | ECO-020 |
| PDF-012 | Piano d'azione Eco-Schools (portfolio) | su richiesta | ECO-021 |

### GA
| ID | Documento | Quando si genera | Storia collegata |
|---|---|---|---|
| PDF-013 | Riepilogo proposta attività (ricevuta) | all'invio della proposta | US-017 |
| PDF-014 | Conferma approvazione (blocco, aula, posti) | all'approvazione | US-018 |
| PDF-015 | Lettera / invito ai relatori | su richiesta del Resp. GA | US-012, US-029 |
| PDF-016 | Programma personale dell'allievo | su richiesta dell'allievo | US-021 |
| PDF-017 | Lista partecipanti + foglio presenze per attività | su richiesta, a iscrizioni chiuse | US-024 |
| PDF-018 | Programma generale e aule (info point, affissione) | su richiesta | US-026 |
| PDF-019 | Richiesta materiali / acquisti alla direzione (con totale) | su richiesta | US-017, US-026 |
| PDF-020 | Modulo rimborso spese (scontrini) | su richiesta | nuova (budget, decisione 22.10) |
| PDF-021 | Attestato / ringraziamento ai relatori | dopo le GA | US-026 |
| PDF-022 | Riepilogo finale per la direzione (numeri, presenze) | dopo le GA | US-027 |

### Assemblea paritetica
| ID | Documento | Quando si genera | Storia collegata |
|---|---|---|---|
| PDF-023 | Convocazione e ordine del giorno | alla creazione della riunione | Fase Assemblea (da scrivere) |
| PDF-024 | Lista presenze da firmare | su richiesta | Fase Assemblea |
| PDF-025 | Verbale con righe I/C/D/E | alla chiusura del verbale | Fase Assemblea |

### Tornei
| ID | Documento | Quando si genera | Storia collegata |
|---|---|---|---|
| PDF-026 | Calendario e tabellone | su richiesta | US-037, US-039 |
| PDF-027 | Referto di partita per l'arbitro | per ogni partita | US-035, US-036 |
| PDF-028 | Diploma per i vincitori | a torneo concluso | US-037 |

### Generale
| ID | Documento | Quando si genera | Storia collegata |
|---|---|---|---|
| PDF-029 | Invito di registrazione docente/relatore con QR code | alla creazione dell'invito | US-012 |
| PDF-030 | Locandina con QR code del sito | su richiesta | US-013 |
| PDF-031 | Festa di fine anno: richiesta budget / preventivo | su richiesta | Festa (da scrivere) |

**Criteri comuni per PDF-002…PDF-031:**
- [ ] Usa `renderPdf` di PDF-001 (nessun modello diverso)
- [ ] Contiene i dati dell'oggetto collegato, protocollo, data, riquadri firma pertinenti
- [ ] Pulsante "Scarica PDF" nella pagina dell'oggetto, solo per chi ha il permesso
- [ ] Test: il PDF si genera, contiene titolo e protocollo attesi, rispetta i permessi
- [ ] Typecheck passes

## 3. Ordine consigliato
PDF-001 prima di tutto. Poi ogni PDF insieme (o subito dopo) la storia collegata della sua fase: non anticipare PDF di fasi non ancora costruite.

## 4. Non-goals
- Firma digitale o qualificata.
- Invio automatico dei PDF per mail.
- Modelli grafici diversi per tipo di documento.
