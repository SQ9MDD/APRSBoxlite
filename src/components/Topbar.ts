import coverageIcon from './icons/map-marker-radius.svg';
import gridIcon from './icons/grid.svg';
import packetIcon from './icons/message-alert.svg';
import packetOffIcon from './icons/message-off.svg';
import resetIcon from './icons/crosshairs-gps.svg';
import rulerIcon from './icons/ruler.svg';
import scrollerIcon from './icons/format-list-bulleted.svg';
import scrollerOffIcon from './icons/format-list-bulleted-square.svg';
import tracksIcon from './icons/track-light.svg';
import tracksOffIcon from './icons/track-light-off.svg';
import coverageOffIcon from './icons/map-marker-radius-outline.svg';
import rulerOffIcon from './icons/ruler-square.svg';
import gridOffIcon from './icons/grid-off.svg';
import darkThemeIcon from './icons/weather-night.svg';
import lightThemeIcon from './icons/weather-sunny.svg';
import systemThemeIcon from './icons/brightness-auto.svg';
import beaconIcon from './icons/access-point.svg';
import paletteIcon from './icons/palette-swatch-outline.svg';
import saveIcon from './icons/content-save-outline.svg';
import generalSettingsIcon from './icons/cog.svg';
import stationSettingsIcon from './icons/antenna.svg';
import interfacesSettingsIcon from './icons/radio-handheld.svg';
import tcpInterfaceIcon from './icons/ethernet.svg?raw';
import serialInterfaceIcon from './icons/serial-port.svg?raw';
import bluetoothInterfaceIcon from './icons/bluetooth.svg?raw';
import internetInterfaceIcon from './icons/web.svg?raw';
import type { AppView } from '../types';
import type { InterfaceSettings, InterfaceConnectionStatus } from '../views/SettingsView';
import { escapeHtml } from './escapeHtml';

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
  offIcon: string;
}

const mapControls: ToolbarControl[] = [
  {
    id: 'tracks',
    label: 'Show or hide tracks',
    icon: tracksIcon,
    offIcon: tracksOffIcon,
  },
  {
    id: 'coverage',
    label: 'Show or hide coverage',
    icon: coverageIcon,
    offIcon: coverageOffIcon,
  },
  {
    id: 'packet',
    label: 'Show or hide latest packet',
    icon: packetIcon,
    offIcon: packetOffIcon,
  },
  {
    id: 'scroller',
    label: 'Show or hide station scroller',
    icon: scrollerIcon,
    offIcon: scrollerOffIcon,
  },
  {
    id: 'ruler',
    label: 'Show or hide ruler',
    icon: rulerIcon,
    offIcon: rulerOffIcon,
  },
  {
    id: 'grid',
    label: 'Show or hide Maidenhead grid',
    icon: gridIcon,
    offIcon: gridOffIcon,
  },
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

const interfacePresentation: Record<InterfaceSettings['type'], { icon: string; label: string }> = {
  'kiss-tcp': { icon: tcpInterfaceIcon, label: 'KISS TCP' },
  'kiss-serial': { icon: serialInterfaceIcon, label: 'KISS Serial' },
  'kiss-ble': { icon: bluetoothInterfaceIcon, label: 'KISS Bluetooth LE' },
  'aprs-is': { icon: internetInterfaceIcon, label: 'APRS-IS' },
};

export function renderInterfaceStatusIcons(
  interfaces: InterfaceSettings[],
  statuses: Record<string, InterfaceConnectionStatus>,
): string {
  return interfaces.map((item) => {
    const status = !item.enabled ? 'disabled' : statuses[item.id] ?? 'disconnected';
    const name = item.name || (item.type === 'kiss-tcp' ? item.hostPort : item.type === 'aprs-is' ? item.aprsIsServer : item.type === 'kiss-ble' ? item.bleDeviceName : item.serialDevice) || item.id;
    const presentation = interfacePresentation[item.type];
    const label = `${name} · ${presentation.label} · ${status}`;
    const icon = presentation.icon.replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
    return `<span class="topbar-interface-status is-${status}" role="img" tabindex="0" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${icon}</span>`;
  }).join('');
}

export function createTopbar(
  view: AppView,
  tools: MapToolState,
  themeMode: ThemeMode,
  settingsSection: SettingsToolbarSection,
  stationLabel: string,
  mapMaskOpacity: number,
  stationFilters: string,
  interfaces: InterfaceSettings[],
  statuses: Record<string, InterfaceConnectionStatus>,
  trafficFilter: string,
  stationSearch: string,
): string {
  const themeIcons: Record<ThemeMode, string> = {
    light: lightThemeIcon,
    dark: darkThemeIcon,
    system: systemThemeIcon,
  };
  const mapToolbar =
    view === 'map'
      ? `<div class="map-manipulators" aria-label="Map tools"><button class="map-tool" data-action="reset-map" type="button" aria-label="Reset map view" title="Reset map view"><img src="${resetIcon}" alt="" /></button>${mapControls.map((control) => `<button class="map-tool ${tools[control.id] ? 'is-active' : ''}" data-tool="${control.id}" type="button" aria-pressed="${tools[control.id]}" aria-label="${control.label}" title="${control.label}"><img src="${tools[control.id] ? control.icon : control.offIcon}" alt="" /></button>`).join('')}<select class="map-mask-select" data-map-mask aria-label="Map mask opacity" title="Map mask opacity">${Array.from(
          { length: 11 },
          (_, index) => index * 10,
        )
          .map(
            (value) =>
              `<option value="${value}"${value === mapMaskOpacity ? ' selected' : ''}>${value}%</option>`,
          )
          .join('')}</select></div>`
      : '';
  const settingsToolbar =
    view === 'settings'
      ? `<div class="settings-manipulators" aria-label="Settings sections">${settingsControls.map((control) => `<button class="map-tool ${settingsSection === control.id ? 'is-active' : ''}" data-settings-section="${control.id}" type="button" aria-pressed="${settingsSection === control.id}" aria-label="${control.label}" title="${control.label}"><img src="${control.icon}" alt="" /></button>`).join('')}</div>`
      : '';
  return `<header class="topbar">${mapToolbar}${settingsToolbar}${view === 'stations' ? `<div class="stations-filters" aria-label="Station filters">${stationFilters}</div><div class="stations-search-container">${stationSearch}</div>` : ''}${view === 'traffic' ? `<button class="map-tool" data-action="traffic-legend" type="button" title="Traffic colors" aria-label="Traffic colors" aria-haspopup="dialog"><img src="${paletteIcon}" alt=""></button><button class="map-tool" data-action="save-traffic-log" type="button" title="Save traffic log" aria-label="Save traffic log"><img src="${saveIcon}" alt=""></button>${trafficFilter}` : ''}<div class="topbar-account"><span class="topbar-callsign">${escapeHtml(stationLabel.replace(/-0$/, ''))}</span><span class="topbar-interfaces" aria-label="Interface status">${renderInterfaceStatusIcons(interfaces, statuses)}</span><button class="theme-toggle" data-action="send-beacon" type="button" aria-label="Send beacon" title="Send beacon"><img src="${beaconIcon}" alt="" /></button><div class="theme-control"><button class="theme-toggle" data-action="cycle-theme" type="button" aria-label="Change color theme (current: ${themeMode})" title="Theme: ${themeMode}"><img src="${themeIcons[themeMode]}" alt="" /></button></div></div></header>`;
}
