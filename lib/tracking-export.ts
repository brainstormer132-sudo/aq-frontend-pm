// Client-side Excel export for tracking sheets.
//
// The PM app has no spreadsheet dependency, so we load SheetJS from the CDN
// on demand (same approach as the contract app). This keeps the bundle small
// and avoids a build-time dependency. Arabic text is preserved.

import type { TrackingRow } from '@/hooks/use-workflow';

const XLSX_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

let loading: Promise<any> | null = null;

/** Ensure window.XLSX exists, injecting the CDN script once. */
function ensureXlsx(): Promise<any> {
  const w = window as any;
  if (w.XLSX) return Promise.resolve(w.XLSX);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = XLSX_SRC;
    s.async = true;
    s.onload = () => (window as any).XLSX ? resolve((window as any).XLSX) : reject(new Error('XLSX failed to load'));
    s.onerror = () => reject(new Error('Could not load the Excel library'));
    document.head.appendChild(s);
  });
  return loading;
}

/** One flat record per tracking row, every field in its own column. */
function toRecord(r: TrackingRow, i: number) {
  return {
    '#': i + 1,
    'Influencer': r.influencer_name || '',
    'Profile link': r.profile_link || '',
    'Platform': r.platform || '',
    'Type of ad': r.type_of_ad || '',
    'Content': r.content || '',
    'Product': r.product || '',
    'Shooting date': r.shooting_date || '',
    'Posting date': r.posting_date || '',
    'Ad status': r.ad_status || '',
    'Ad link': r.ad_link || '',
    'Price (excl. VAT)': Number(r.price_excl || 0),
    'Price (incl. 15% VAT)': Number(r.price_incl || 0),
    'Event': r.is_event ? 'Yes' : 'No',
    'Guest': r.guest || '',
    'Location': r.location || '',
    'Time': r.visit_time || '',
    'License plate photo': r.license_plate_url || '',
    'Contact number': r.contact_number || '',
    'Notes': r.notes || '',
  };
}

function safeName(s: string): string {
  return (s || 'tracking-sheet').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'tracking-sheet';
}

/** Build and download an .xlsx of the given rows. */
export async function exportTrackingXlsx(sheetTitle: string, rows: TrackingRow[]) {
  const XLSX = await ensureXlsx();
  const records = rows.map(toRecord);
  const ws = XLSX.utils.json_to_sheet(records);

  // Reasonable column widths.
  const headers = Object.keys(records[0] ?? { '#': 1 });
  ws['!cols'] = headers.map((h) => ({
    wch: h === 'Content' || h === 'Notes' || h.includes('link') || h.includes('photo') ? 28
       : h === 'Influencer' || h === 'Location' ? 20
       : Math.max(10, h.length + 2),
  }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Tracking');
  XLSX.writeFile(wb, `Tracking - ${safeName(sheetTitle)}.xlsx`);
}
