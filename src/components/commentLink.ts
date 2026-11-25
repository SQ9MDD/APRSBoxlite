import { escapeHtml } from './escapeHtml';

export function renderComment(value: string): string {
  const match = value.match(/^https?:\/\/\S+/i);
  if (!match) return escapeHtml(value);
  try {
    const url = new URL(match[0]);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return escapeHtml(value);
  } catch { return escapeHtml(value); }
  const link = escapeHtml(match[0]);
  return `<a href="${link}" data-external-link>${link}</a>${escapeHtml(value.slice(match[0].length))}`;
}
