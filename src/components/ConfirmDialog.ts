export interface Confirmation {
  title: string;
  message: string;
  kind?: 'conversation';
}

export function createConfirmDialog(
  confirmation: Confirmation | undefined,
): string {
  if (!confirmation) return '';
  return `<div class="alert-backdrop"><section class="alert-dialog confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title"><div class="alert-symbol alert-symbol-warning">!</div><h2 id="confirm-title">${escapeHtml(confirmation.title)}</h2><p>${escapeHtml(confirmation.message)}</p><div class="dialog-actions"><button class="outline-button" data-action="${confirmation.kind === 'conversation' ? 'cancel-delete-conversation' : 'cancel-delete-interface'}" type="button" autofocus>Cancel</button><button class="danger-button" data-action="${confirmation.kind === 'conversation' ? 'confirm-delete-conversation' : 'confirm-delete-interface'}" type="button">Delete</button></div></section></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}
