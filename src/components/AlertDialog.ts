export interface AlertMessage {
  title: string;
  message: string;
  tone: 'success' | 'error';
}

export function createAlertDialog(alert: AlertMessage | undefined): string {
  if (!alert) return '';
  return `<div class="alert-backdrop"><section class="alert-dialog alert-${alert.tone}" role="alertdialog" aria-modal="true" aria-labelledby="alert-title"><div class="alert-symbol">${alert.tone === 'success' ? '✓' : '!'}</div><h2 id="alert-title">${alert.title}</h2><p>${alert.message}</p><button class="primary-button" data-action="close-alert" type="button" autofocus>OK</button></section></div>`;
}
