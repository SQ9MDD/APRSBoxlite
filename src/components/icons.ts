const paths: Record<string, string> = {
  map: '<path d="M3 5.5 9 3l6 2.5L21 3v15.5L15 21l-6-2.5-6 2.5V5.5Z"/><path d="M9 3v15.5M15 5.5V21"/>',
  stations:
    '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  traffic:
    '<path d="M12 20a8 8 0 1 0-8-8"/><path d="M12 16a4 4 0 1 0-4-4M2 2l4.5 4.5M18 18l4 4"/><circle cx="12" cy="12" r="1"/>',
  messages:
    '<path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8Z"/><path d="M7 9h10M7 13h6"/>',
  interfaces:
    '<path d="M7 3v18M17 3v18M3 7h4M3 17h4M17 7h4M17 17h4"/><path d="M7 12h10"/>',
  station:
    '<path d="M12 22s7-4.35 7-12a7 7 0 1 0-14 0c0 7.65 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.1 2.1-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51v.09h-3v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06-2.1-2.1.06-.06A1.65 1.65 0 0 0 7.17 15a1.65 1.65 0 0 0-1.51-1H5.57v-3h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.1-2.1.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51v-.09h3v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06 2.1 2.1-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1h.09v3h-.09a1.65 1.65 0 0 0-1.51 1Z"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  signal: '<path d="M4 18v-2M8 18v-5M12 18V9M16 18V5M20 18V2"/>',
};

export function icon(name: string, className = ''): string {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ''}</svg>`;
}
