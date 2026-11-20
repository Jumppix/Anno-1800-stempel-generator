import { defineConfig } from 'vite';

// GitHub Pages serves project sites under /<repo>/. Local development and
// preview stay at / on the machine. GitHub Actions sets GITHUB_ACTIONS and
// GITHUB_REPOSITORY automatically, so no hard-coded repository name is needed.
const repo = process.env.GITHUB_REPOSITORY?.split('/')[1];
const base = process.env.GITHUB_ACTIONS === 'true' && repo ? `/${repo}/` : '/';

export default defineConfig({
  base,
  // Mehrere Seiten: Startseite, Datenbank, Stadtplaner/Stempel-Werkzeug.
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        datenbank: 'datenbank.html',
        produktion: 'produktion.html',
        baumaterial: 'baumaterial.html',
        planer: 'planer.html',
      },
    },
  },
  // Module-Worker (alle Worker werden mit type: 'module' gestartet); nötig,
  // damit der Pipeline-Worker HiGHS nur bei Bedarf nachladen kann.
  worker: { format: 'es' },
});
