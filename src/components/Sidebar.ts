import { icon } from './icons';
import type { AppView } from '../types';

const navigation: Array<{ id: AppView; label: string; icon: string }> = [
  { id: 'map', label: 'Map', icon: 'map' },
  { id: 'stations', label: 'Stations', icon: 'stations' },
  { id: 'traffic', label: 'Traffic Monitor', icon: 'traffic' },
  { id: 'messages', label: 'Messages', icon: 'messages' },
  { id: 'settings', label: 'Settings', icon: 'settings' },
];

export function createSidebar(activeView: AppView): string {
  return `<aside class="sidebar"><div class="brand"><div class="brand-mark">⌁</div><strong>APRS<span>Box</span>lite</strong></div><nav class="navigation" aria-label="Primary navigation">${navigation.map((item) => `<button class="nav-item ${activeView === item.id ? 'is-active' : ''}" data-view="${item.id}" type="button">${icon(item.icon)}<span>${item.label}</span>${activeView === item.id ? icon('chevron', 'nav-chevron') : ''}</button>`).join('')}</nav></aside>`;
}
