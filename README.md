# PhiloGenius demo

Self-contained demo for a Genius-like inline annotation reader. It loads a public-domain text file, supports selection-based annotations, hover previews, a right-hand annotation panel, shareable hash links, and simple search.

## Run
Serve the folder with any static server:
- Python: `python -m http.server 8000` then open `http://localhost:8000/philo-genius/index.html`
- Node: `npx http-server`

## Text
The demo ships with a short German sample of Nietzsche's *Der Antichrist*. Replace `texts/antichrist_de_sample.txt` with a full public-domain text file suitable for your jurisdiction, and update the link if needed. Avoid uploading in-copyright translations where they are not public domain in your country.

## Storage
Annotations persist in `localStorage`. Use Export/Import for backup.
