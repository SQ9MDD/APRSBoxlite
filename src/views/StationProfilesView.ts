import { escapeHtml } from '../components/escapeHtml';
import type { ProfileAction, StationProfile } from '../stationProfiles';
import { profileLabel } from '../stationProfiles';

export type ProfileDialog = { action: 'create' | 'duplicate' | 'rename'; name: string };

export function renderStationProfiles(profiles: StationProfile[], activeId: string): string {
  return `<section class="configuration-form profile-controls" aria-label="Station profiles"><label>Active profile<select data-profile-select aria-label="Active station profile">${profiles.map((profile, index) => `<option value="${escapeHtml(profile.id)}" ${profile.id === activeId ? 'selected' : ''}>${escapeHtml(profileLabel(profile, index))}</option>`).join('')}</select></label><div class="form-actions"><button class="outline-button" data-profile-action="create" type="button">Create</button><button class="outline-button" data-profile-action="duplicate" type="button">Duplicate</button><button class="outline-button" data-profile-action="rename" type="button">Rename</button><button class="outline-button" data-profile-action="delete" type="button" ${profiles.length <= 1 ? 'disabled' : ''}>Delete</button></div><small>Station changes are saved when switching profiles. Pending transmissions are cancelled.</small></section>`;
}

export function renderProfileDialog(dialog: ProfileDialog | undefined): string {
  if (!dialog) return '';
  const titles: Partial<Record<ProfileAction['action'], string>> = { create: 'Create profile', duplicate: 'Duplicate profile', rename: 'Rename profile' };
  const title = titles[dialog.action];
  return `<div class="modal-backdrop"><form class="phg-dialog" data-profile-dialog role="dialog" aria-modal="true" aria-labelledby="profile-title"><div class="dialog-header"><h3 id="profile-title">${title}</h3></div><div class="form-grid"><label class="form-span-2">Profile name<input data-profile-name value="${escapeHtml(dialog.name)}" maxlength="80" required /></label></div>${dialog.action === 'create' ? '<p>New profiles start with an empty callsign, no enabled interfaces and automatic transmissions off.</p>' : ''}<div class="form-actions"><button class="outline-button" data-action="cancel-profile-dialog" type="button">Cancel</button><button class="primary-button" type="submit">${title}</button></div></form></div>`;
}
