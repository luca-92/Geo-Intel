# Geo Intel MVP v4

Servizio web containerizzato per gestire punti geografici, tab informativi, allegati e utenti.

## Funzionalita implementate

- Home compatta per creare un nuovo punto
- Gestione punti con modifica completa
- Marker personalizzabili con colore e icona
- Tab dinamici per ogni punto
- Ricerca e filtri lato interfaccia
- Gestione allegati con upload, download ed eliminazione
- Gestione utenti e ruoli `admin`, `editor`, `viewer`
- Statistiche rapide
- Export JSON e import JSON
- Persistenza database e file allegati via volumi Docker

## Avvio

```bash
docker-compose up --build
```

Frontend: http://localhost:3000

Backend API: http://localhost:8000

## Note operative

- Gli allegati vengono salvati nel volume Docker `backend_uploads`.
- L'export JSON include punti, tab, utenti e metadati degli allegati, ma non i file binari.
- All'avvio vengono creati utenti seed di esempio se la tabella utenti e vuota:
  - `admin / admin@example.com`
  - `editor / editor@example.com`
  - `viewer / viewer@example.com`

## Compatibilita con database esistente

Il backend prova ad aggiungere automaticamente le nuove colonne e tabelle principali in avvio.
Su installazioni gia molto modificate potrebbe comunque essere necessario azzerare i volumi e ricreare lo stack.


## NocoDB integration
Copy `.env.example` to `.env` and set `NOCODB_BASE_URL`, `NOCODB_API_TOKEN`, and `NOCODB_BASE_ID` before starting Docker Compose if you want to use the NocoDB tab integration.


## NocoDB configuration
Set your real NocoDB values in the included `.env` file before starting:

```env
NOCODB_BASE_URL=http://YOUR_NOCO_HOST:8080
NOCODB_API_TOKEN=your-xc-token
NOCODB_BASE_ID=your-base-id
```

Then run:

```bash
docker-compose down -v
docker-compose up --build
```
