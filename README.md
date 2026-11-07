# Invoice OCR

Upload invoices (PDF or image), extract their data with a local vision model via [Ollama](https://ollama.com), and store it in MongoDB.

Processing runs in the background with one model: `gemma4:e4b` reads the page images and returns structured JSON (invoice header, line items, and notes). PDFs are rendered to PNG first with `mupdf`, up to `MAX_PDF_PAGES` pages, and all pages go to the model in one call. `benchmark-results.xlsx` has the comparison that picked this setup over the earlier `glm-ocr` → `gemma4:e2b` pipeline.

Uploads return straight away. Each document moves through `queued → converting → extracting → saving → done` (or `failed`, with an error message), and the page at http://localhost:3000 shows its progress live.

## Requirements

- [Bun](https://bun.sh)
- Ollama 0.30.9 or newer, with the model pulled:
  ```sh
  ollama pull gemma4:e4b
  ```
- MongoDB on `127.0.0.1:27017`. Use `127.0.0.1` rather than `localhost`: on Windows, `localhost` can resolve to IPv6 `::1`.

## Run

```sh
bun install
bun run dev
```

Open http://localhost:3000.

To change the defaults, copy `.env.example` to `.env`. Bun loads `.env` automatically.

## MongoDB collections

| Collection      | Contents |
|-----------------|----------|
| `documents`     | One per uploaded file: status, stage, page count, error, raw model output (`extractRaw`) |
| `invoices`      | Invoice no, label, date, supplier, contact, customer, currency, subtotal, tax, grand total, notes |
| `invoice_items` | Line items: description, quantity, unit, price, total |

## API

| Method | Path | |
|--------|------|-|
| POST   | `/api/documents` | multipart upload, field `files` (repeat for multiple); returns 202 |
| GET    | `/api/documents` | list, with status and stage |
| GET    | `/api/documents/:id` | full record, including `extractRaw` |
| GET    | `/api/documents/:id/file` | original file |
| POST   | `/api/documents/:id/retry` | reprocess the document |
| DELETE | `/api/documents/:id` | delete the document, its file, invoice and items |
| GET    | `/api/invoices` | invoices with `items[]` |
| GET    | `/api/invoices/:id` | one invoice with items |

Example:

```sh
curl -F "files=@invoice1.pdf" -F "files=@invoice2.jpg" http://localhost:3000/api/documents
```
