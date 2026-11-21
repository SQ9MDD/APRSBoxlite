import coverageIcon from './icons/map-marker-radius.svg';
import gridIcon from './icons/grid.svg';
import packetIcon from './icons/clipboard-text-multiple-outline.svg';
import resetIcon from './icons/refresh.svg';
import rulerIcon from './icons/ruler.svg';
import scrollerIcon from './icons/view-list-outline.svg';
import tracksIcon from './icons/track-light.svg';
import darkThemeIcon from './icons/weather-night.svg';
import lightThemeIcon from './icons/weather-sunny.svg';
import systemThemeIcon from './icons/brightness-auto.svg';
import generalSettingsIcon from './icons/cog.svg';
import stationSettingsIcon from './icons/home.svg';
import interfacesSettingsIcon from './icons/serial-port.svg';
import type { AppView } from '../types';

export type MapToolId =
  | 'tracks'
  | 'coverage'
  | 'packet'
  | 'scroller'
  | 'ruler'
  | 'grid';

export type MapToolState = Record<MapToolId, boolean>;
export type ThemeMode = 'light' | 'dark' | 'system';
export type SettingsToolbarSection = 'general' | 'station' | 'interfaces';

interface ToolbarControl {
  id: MapToolId;
  label: string;
  icon: string;
}

const mapControls: ToolbarControl[] = [
  { id: 'tracks', label: 'Show or hide tracks', icon: tracksIcon },
  { id: 'coverage', label: 'Show or hide coverage', icon: coverageIcon },
  { id: 'packet', label: 'Show or hide latest packet', icon: packetIcon },
  {
    id: 'scroller',
    label: 'Show or hide station scroller',
    icon: scrollerIcon,
  },
  { id: 'ruler', label: 'Show or hide ruler', icon: rulerIcon },
  { id: 'grid', label: 'Show or hide Maidenhead grid', icon: gridIcon },
];

const settingsControls: Array<{
  id: SettingsToolbarSection;
  label: string;
  icon: string;
}> = [
  { id: 'general', label: 'General settings', icon: generalSettingsIcon },
  { id: 'station', label: 'My station', icon: stationSettingsIcon },
  { id: 'interfaces', label: 'Interfaces', icon: interfacesSettingsIcon },
];

export function createTopbar(
  view: AppView,
  tools: MapToolState,
  themeMode: ThemeMode,
  themeMenuOpen: boolean,
  settingsSection: SettingsToolbarSection,
  stationLabel: string,
): string {
  const themeIcons: Record<ThemeMode, string> = {
    light: lightThemeIcon,
    dark: darkThemeIcon,
    system: systemThemeIcon,
  };
  const mapToolbar =
    view === 'map'
      ? `<div class="map-manipulators" aria-label="Map tools"><button class="map-tool" data-action="reset-map" type="button" aria-label="Reset map view" title="Reset map view"><img src="${resetIcon}" alt="" /></button>${mapControls.map((control) => `<button class="map-tool ${tools[control.id] ? 'is-active' : ''}" data-tool="${control.id}" type="button" aria-pressed="${tools[control.id]}" aria-label="${control.label}" title="${control.label}"><img src="${control.icon}" alt="" /></button>`).join('')}</div>`
      : '';
  const settingsToolbar =
    view === 'settings'
      ? `<div class="settings-manipulators" aria-label="Settings sections">${settingsControls.map((control) => `<button class="map-tool ${settingsSection === control.id ? 'is-active' : ''}" data-settings-section="${control.id}" type="button" aria-pressed="${settingsSection === control.id}" aria-label="${control.label}" title="${control.label}"><img src="${control.icon}" alt="" /></button>`).join('')}</div>`
      : '';
  const themeMenu = themeMenuOpen
    ? `<div class="theme-menu" role="menu"><button class="${themeMode === 'light' ? 'is-active' : ''}" data-theme="light" type="button" role="menuitem"><img src="${lightThemeIcon}" alt="" />Light</button><button class="${themeMode === 'dark' ? 'is-active' : ''}" data-theme="dark" type="button" role="menuitem"><img src="${darkThemeIcon}" alt="" />Dark</button><button class="${themeMode === 'system' ? 'is-active' : ''}" data-theme="system" type="button" role="menuitem"><img src="${systemThemeIcon}" alt="" />System</button></div>`
    : '';
  return `<header class="topbar">${mapToolbar}${settingsToolbar}<div class="topbar-account"><span class="topbar-callsign"><span class="status-dot"></span>${stationLabel}</span><div class="theme-control"><button class="theme-toggle" data-action="toggle-theme-menu" type="button" aria-label="Change color theme" aria-expanded="${themeMenuOpen}" title="Theme: ${themeMode}"><img src="${themeIcons[themeMode]}" alt="" /></button>${themeMenu}</div></div></header>`;
}
