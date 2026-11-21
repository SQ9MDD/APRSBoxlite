export function renderMessagesView(): { html: string } {
  return {
    html: `<div class="empty-view"><div class="empty-icon">✉</div><span class="eyebrow">Message inbox</span><h2>No APRS messages yet</h2><p>Messages will appear here when the APRS message feature is connected.</p><button class="primary-button" type="button" disabled>Compose message</button></div>`,
  };
}
