# Visioni

Gioco di indizi e immagini per telefono. A turno un narratore sceglie una carta e dà un indizio;
gli altri giocano la carta della loro mano che più ci si avvicina; poi tutti votano quale sia quella
del narratore.

App statica (HTML/CSS/JS senza build). Lo stato è condiviso con Firebase Realtime Database,
lo stesso progetto di Carte Infami, nei rami `vrooms` / `vhands`.

## Regole del database

Le regole in `database.rules.json` coprono **entrambi** i giochi (Carte Infami e Visioni):
vanno incollate in Firebase → Realtime Database → Regole → Pubblica.

## Prova in locale

```bash
python -m http.server 8081
```

Apri <http://localhost:8081/?test> in tre schede (con `?test` ogni scheda è un giocatore diverso).

## Punteggio

- Se tutti o nessuno trovano la carta del narratore: narratore 0, gli altri 2.
- Altrimenti narratore e chi l'ha trovata: 3.
- Ogni giocatore (narratore escluso) prende 1 punto per ogni voto ricevuto dalla sua carta.
- Vince chi arriva per primo al traguardo (15, 20 o 30 punti).

## Immagini

`cards/001.jpg` … `cards/241.jpg`, con titolo, autore e data in `cards.json`.
Sono opere di pubblico dominio dell'Art Institute of Chicago, rilasciate con licenza CC0
(<https://www.artic.edu/open-access/open-access-images>). Nel gioco: "Le opere del mazzo".
