import mapIcon from './icons/map-outline.svg';
import stationsIcon from './icons/account-multiple.svg';
import trafficIcon from './icons/radio-tower.svg';
import messagesIcon from './icons/message-reply-text-outline.svg';
import messagesAlertIcon from './icons/message-alert-outline.svg';
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

export function createSidebar(activeView: AppView, hasUnreadMessages = false): string {
  const displayVersion = version.replace('-', '.');
  return `<aside class="sidebar"><div class="brand"><strong>APRS<span>Box</span>lite</strong></div><button type="button" class="sidebar-clock" data-action="toggle-clock" aria-label="UTC clock; switch to local time" title="UTC (click for LOC)"><span class="sidebar-clock-time" data-clock-time></span><span class="sidebar-clock-date-row"><span data-clock-date></span><span data-clock-zone>UTC</span></span></button><nav class="navigation" aria-label="Primary navigation">${navigation.map((item) => `<button class="nav-item ${activeView === item.id ? 'is-active' : ''} ${item.id === 'messages' && hasUnreadMessages ? 'has-unread' : ''}" data-view="${item.id}" type="button"><img class="nav-icon" src="${item.id === 'messages' && hasUnreadMessages ? messagesAlertIcon : item.icon}" ${item.id === 'messages' ? `data-normal-icon="${messagesIcon}" data-alert-icon="${messagesAlertIcon}"` : ''} alt=""><span>${item.label}</span></button>`).join('')}</nav><footer class="sidebar-footer"><div>APRSBoxlite version ${displayVersion}</div><div class="sidebar-copyright">Copyright SQ9MDD</div></footer></aside>`;
}
