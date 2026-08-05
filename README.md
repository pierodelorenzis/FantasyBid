<p align="center">
  <img src="./favicon.svg" alt="Logo FantaBid" width="96" height="96">
</p>

<h1 align="center">FantaBid</h1>

<p align="center">
  La webapp per organizzare e gestire in tempo reale l'asta del fantacalcio.
</p>

FantaBid riunisce tutta la lega in un'unica stanza d'asta: l'amministratore crea la lega, importa il listone dei giocatori e configura fasce, prezzi di partenza, rilanci e limiti di spesa; i partecipanti accedono tramite un semplice codice, senza registrazione, e fanno le proprie offerte in diretta.

La piattaforma controlla automaticamente budget e validità dei rilanci, aggiorna l'asta per tutti i partecipanti, compone le rose e consente di esportare i risultati in formato CSV.

## Avvio

```bash
npm start
```

Apri [http://localhost:3000](http://localhost:3000).

Se la porta 3000 è già in uso, scegli una porta differente:

```bash
PORT=3001 npm start
```

## Flussi disponibili

- L’admin crea una lega, riceve un codice e condivide il link.
- Un partecipante entra senza registrazione indicando codice e nome.
- L’admin avvia/ferma l’asta, modifica soglie per fascia e assegna il giocatore chiamato.
- Il server applica prezzo iniziale, rilancio minimo, budget e tetti di spesa per fascia.
- Le pagine si aggiornano automaticamente ogni 3,5 secondi per tutti i partecipanti.
- Admin e partecipanti possono scaricare i rispettivi CSV.

Questa implementazione è pensata per una lega locale o un server privato. Per la pubblicazione su Internet vanno aggiunti HTTPS, autenticazione robusta e un database gestito.
