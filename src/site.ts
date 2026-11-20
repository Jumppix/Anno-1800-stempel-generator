// Gemeinsamer Rahmen der Hilfeseite: Kopfzeile mit Navigation und
// Sprachumschalter, Fußzeile mit Fanprojekt-Hinweis.
import './site-frame.css';
import { applyI18n, getLang, onLangChange, setLang, t } from './i18n';
import { getPalaceSettings, onPalaceSettings, openPalaceDialog, palaceSummary } from './palaceSettings';

export type Page = 'start' | 'db' | 'prod' | 'guide' | 'planner';

export function mountSite(page: Page): void {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <a class="site-brand" href="./"><span class="site-mark">A</span><span data-i18n="site.title"></span></a>
    <nav class="site-nav">
      <a href="./" data-i18n="nav.start" ${page === 'start' ? 'aria-current="page"' : ''}></a>
      <a href="./datenbank.html" data-i18n="nav.db" ${page === 'db' ? 'aria-current="page"' : ''}></a>
      <a href="./produktion.html" data-i18n="nav.prod" ${page === 'prod' ? 'aria-current="page"' : ''}></a>
      <a href="./baumaterial.html" data-i18n="nav.guide" ${page === 'guide' ? 'aria-current="page"' : ''}></a>
      <a href="./planer.html" data-i18n="nav.planner" ${page === 'planner' ? 'aria-current="page"' : ''}></a>
    </nav>
    <div class="site-tools">
      <button class="site-palace" type="button"><span aria-hidden="true">🏛</span> <span data-i18n="pal.button"></span></button>
      ${page === 'planner' ? '' : '<button class="site-lang" type="button" data-i18n="lang.switch"></button>'}
    </div>`;
  document.body.prepend(header);
  document.body.classList.add('with-header');

  // Der Stadtplaner füllt den ganzen Platz und ist noch nur deutsch: ohne Fußzeile und Sprachwahl.
  if (page !== 'planner') {
    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = '<p data-i18n="footer.fan"></p>';
    document.body.append(footer);
  }

  header.querySelector<HTMLButtonElement>('.site-lang')?.addEventListener('click', () => setLang(getLang() === 'de' ? 'en' : 'de'));
  // Palast-Einstellungen gelten für die ganze Seite (Produktion, Stadtplaner)
  const palBtn = header.querySelector<HTMLButtonElement>('.site-palace');
  const palTip = (): void => {
    if (palBtn) palBtn.title = `${t('pal.title')}: ${palaceSummary(getPalaceSettings())}`;
  };
  palBtn?.addEventListener('click', () => void openPalaceDialog());
  palTip();
  onPalaceSettings(palTip);
  onLangChange(palTip);
  applyI18n();
  if (page === 'planner') return; // Titel steht in planer.html
  const title = (): void => {
    const sub = page === 'db' ? t('db.title') : page === 'prod' ? t('prod.title') : page === 'guide' ? t('guide.title') : '';
    document.title = sub ? `${sub} · ${t('site.title')}` : t('site.title');
  };
  title();
  onLangChange(title);
}
