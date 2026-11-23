// Herkunft eines Items (Händler, Herstellung, Expedition, Quest …) als HTML.
import { t } from '../i18n';
import type { Item } from './data';


/**
 * @param named Darstellung eines Namens mit Icon (GUID → HTML)
 * @param num Zahl formatieren
 */
export function originHtml(it: Item, named: (g: number) => string, num: (n: number) => string, esc: (s: string) => string): string {
  const s = it.src;
  if (it.pal) return `<div class="hc-note">${esc(t('origin.palace'))}</div>`;
  if (!s) return `<div class="hc-note">${esc(t('origin.none'))}</div>`;
  const rows: string[] = [];
  if (s.tr?.length) {
    rows.push(
      `<div class="hc-cap">${esc(t('origin.trader'))}</div><div class="hc-list">${[...s.tr]
        .map((x) => named(x.g))
        .join('')}</div>`,
    );
  }
  if (s.cr?.length) {
    rows.push(
      `<div class="hc-cap">${esc(t('origin.craft'))}</div><div class="hc-list">${s.cr
        .map((x) => `${named(x.g)}<span class="hc-note">${esc(t(`reg.${x.reg}`))}</span>`)
        .join('')}</div>`,
    );
  }
  const counts: Array<[string, number | undefined]> = [
    ['origin.expedition', s.ex],
    ['origin.quest', s.qu],
    ['origin.diving', s.dv],
    ['origin.worldfair', s.wf],
    ['origin.tourism', s.to],
  ];
  const other = counts.filter(([, n]) => n);
  if (other.length) {
    rows.push(`<div class="hc-list">${other.map(([k, n]) => `<span class="hc-tag">${esc(t(k, { n: num(n as number) }))}</span>`).join('')}</div>`);
  }
  return rows.join('');
}
