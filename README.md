# FantaBid

Web app completa per aste di fantacalcio, con server Node.js e persistenza locale in `data.json` (creato automaticamente al primo utilizzo).

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
