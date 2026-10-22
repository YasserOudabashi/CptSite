# Matrice permessi — BOZZA v2 (15.10)

**Logica**: ognuno ha un ruolo base (Allievo o Docente; il Relatore è esterno). Gli altri ruoli **aggiungono** permessi, non li tolgono: i permessi di una persona sono l'unione di tutti i suoi ruoli. Quindi un Membro Assemblea che è anche allievo si iscrive alle GA come allievo: nessun conflitto.
La colonna di un ruolo aggiuntivo mostra solo cosa **aggiunge** (vuoto = niente di extra).
Yasser = Responsabile sito: fa tutto, nessuna colonna. Tutto è filtrato per anno scolastico.

Legenda: **V** vede · **M** crea/modifica · **A** approva.

| Pagina / azione | Allievo | Docente | Relatore | Organizzatore (+) | Resp. GA (+) | Resp. Eco (+) | Resp. Assemblea (+) | Membro Assemblea (+) |
|---|---|---|---|---|---|---|---|---|
| Home, info GA | V | V | V | | | | | |
| Elenco attività GA + filtri + posti liberi | V | V | V | | | | | |
| Iscriversi alle GA | M | M | | | | | | |
| Proporre attività GA | M | M | M | | | | | |
| La mia attività GA (iscritti, descrizione) | | | | M (solo sue) | | | | |
| Segnare presenze GA | | M (sue) | M (sue) | M (sue, anche se allievo) | M (tutte) | | | |
| Gestione GA (attività, iscritti, export, apri/chiudi iscrizioni) | | | | | M | | | |
| Approvare attività GA | | | | | A | | | |
| Relatori / contatti / mail ricevute GA | | | | | V | | | |
| Eco: attività e giorni liberi | V | V | | | | | | |
| Eco: iscriversi | M | M | | | | | | |
| Eco: proporre attività / richiedere materiali | M | M | | | | | | |
| Eco: la mia attività (iscritti, tetto) | | | | M (solo sue) | | | | |
| Eco: approvare attività | | | | | | A (Ramon) | | |
| Eco: calendario aula (aperta/chiusa, orari) | | | | | | M (Lorenzo) | | |
| Eco: attività, iscritti, responsabili | | | | | | V (tutti i resp.) | | |
| Eco: file riunioni, lista materiali | | | | | | M | | |
| Assemblea: verbali, date | | | | | | | M | V |
| Assemblea: segnare presente/assente | | | | | | | M (tutti) | M (sé) |
| Sondaggi: votare | M | M | | | | | | |
| Sondaggi: creare | | | | | M | M | M | |

### Tornei (ruoli aggiuntivi)
Resp. tornei (più persone) · Organizzatore torneo (per singolo torneo) · Arbitro (per le partite assegnate).

| Azione | Allievo / Docente | Organizzatore torneo (+) | Arbitro (+) | Resp. tornei (+) |
|---|---|---|---|---|
| Vedere tornei, calendario, classifiche, le mie partite | V | | | |
| Iscrivere/ritirare la propria squadra o sé stessi | M | | | |
| Aggiungere/togliere/approvare squadre a mano | | M (suo torneo) | | M |
| Generare calendario, campi, orari, arbitri | | M (suo torneo) | | M |
| Inserire/correggere risultati (solo arbitri e organizzatori) | | M (suo torneo) | M (sue partite) | |
| Creare torneo collegato alla propria attività GA | | M (Organizzatore GA) | | M |
| Creare torneo libero, assegnare organizzatori e arbitri, archivio, export | | | | M |

Solo Resp. sito: utenti, ruoli, import ID, impostazioni (anno, date, blocchi orari).
Resp. Eco: Lorenzo = aula · Yasser = comunicazione docenti/direzione · Ramon = gestione e approvazione attività.
Il Responsabile GA approva da solo, senza altri passaggi nel sito (la Direzione approva fuori dal sito).
