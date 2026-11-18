// Gemeinsamer Rahmen der Hilfeseite: Kopfzeile mit Navigation und
// Sprachumschalter, Fußzeile mit Fanprojekt-Hinweis.
import './site.css';
import { applyI18n, getLang, onLangChange, setLang, t } from './i18n';

export type Page = 'start' | 'db';

export function mountSite(page: Page): void {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <a class="site-brand" href="./"><span class="site-mark">A</span><span data-i18n="site.title"></span></a>
    <nav class="site-nav">
      <a href="./" data-i18n="nav.start" ${page === 'start' ? 'aria-current="page"' : ''}></a>
      <a href="./datenbank.html" data-i18n="nav.db" ${page === 'db' ? 'aria-current="page"' : ''}></a>
      <a href="./planer.html" data-i18n="nav.planner"></a>
    </nav>
    <button class="site-lang" type="button" data-i18n="lang.switch"></button>`;
  document.body.prepend(header);

  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = '<p data-i18n="footer.fan"></p>';
  document.body.append(footer);

  header.querySelector<HTMLButtonElement>('.site-lang')?.addEventListener('click', () => setLang(getLang() === 'de' ? 'en' : 'de'));
  applyI18n();
  const title = (): void => {
    document.title = page === 'db' ? `${t('db.title')} · ${t('site.title')}` : t('site.title');
  };
  title();
  onLangChange(title);
}
