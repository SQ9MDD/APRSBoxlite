import mapIcon from './icons/map-outline.svg';
import stationsIcon from './icons/account-multiple.svg';
import trafficIcon from './icons/radio-tower.svg';
import messagesIcon from './icons/message-reply-text-outline.svg';
import settingsIcon from './icons/cog.svg';
import type { AppView } from '../types';
import { version } from '../../package.json';

const navigation: Array<{ id: AppView; label: string; icon: string }> = [
  { id: 'map', label: 'Map', icon: mapIcon },
  { id: 'stations', label: 'Stations', icon: stationsIcon },
  { id: 'traffic', label: 'Traffic Monitor', icon: trafficIcon },
  { id: 'messages', label: 'Messages', icon: messagesIcon },
  { id: 'settings', label: 'Settings', icon: settingsIcon },
];

export function createSidebar(activeView: AppView): string {
  const displayVersion = version.replace('-', '.');
  return `<aside class="sidebar"><div class="brand"><strong>APRS<span>Box</span>lite</strong></div><nav class="navigation" aria-label="Primary navigation">${navigation.map((item) => `<button class="nav-item ${activeView === item.id ? 'is-active' : ''}" data-view="${item.id}" type="button"><img class="nav-icon" src="${item.icon}" alt=""><span>${item.label}</span></button>`).join('')}</nav><footer class="sidebar-footer"><div>APRSBoxlite version ${displayVersion}</div><div>Copyright SQ9MDD</div></footer></aside>`;
}
