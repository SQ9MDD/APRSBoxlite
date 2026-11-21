import calculatorIcon from '../components/icons/calculator-variant.svg';
import locationIcon from '../components/icons/crosshairs-gps.svg';
import checkIcon from '../components/icons/check-circle.svg';
import closeIcon from '../components/icons/close-circle.svg';
import deleteIcon from '../components/icons/delete-outline.svg';
import lockIcon from '../components/icons/lock-outline.svg';
import lockOpenIcon from '../components/icons/lock-open-outline.svg';
import pauseIcon from '../components/icons/pause-circle.svg';
import playIcon from '../components/icons/play-circle-outline.svg';
import plusIcon from '../components/icons/plus-circle-outline.svg';

export type SettingsSection = 'general' | 'station' | 'interfaces';

export interface StationSettings {
  callsign: string;
  ssid: string;
  comment: string;
  location: string;
  status: string;
  beaconInterval: string;
  statusInterval: string;
}

export interface PhgValues {
  power: string;
  height: string;
  gain: string;
  direction: string;
}

export interface InterfaceSettings {
  id: string;
  name: string;
  type: 'kiss-tcp' | 'kiss-serial';
  enabled: boolean;
  txBlocked: boolean;
  hostPort: string;
  serialDevice: string;
  baudRate: string;
  reconnectTimeout: string;
}

export type InterfaceConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export function renderSettingsView(
  activeSection: SettingsSection,
  interfaces: InterfaceSettings[],
  interfaceDraft: InterfaceSettings,
  selectedInterfaceId: string | undefined,
  interfaceStatuses: Record<string, InterfaceConnectionStatus>,
  stationSettings: StationSettings,
  locationAccuracy: string | undefined,
  phgCalculatorOpen: boolean,
  phgValues: PhgValues,
): { html: string } {
  return {
    html: `<div class="settings-view">${renderSection(activeSection, interfaces, interfaceDraft, selectedInterfaceId, interfaceStatuses, stationSettings, locationAccuracy, phgCalculatorOpen, phgValues)}</div>`,
  };
}

function renderSection(
  activeSection: SettingsSection,
  interfaces: InterfaceSettings[],
  interfaceDraft: InterfaceSettings,
  selectedInterfaceId: string | undefined,
  interfaceStatuses: Record<string, InterfaceConnectionStatus>,
  stationSettings: StationSettings,
  locationAccuracy: string | undefined,
  phgCalculatorOpen: boolean,
  phgValues: PhgValues,
): string {
  if (activeSection === 'station')
    return renderStationForm(
      stationSettings,
      locationAccuracy,
      phgCalculatorOpen,
      phgValues,
    );
  if (activeSection === 'interfaces')
    return renderInterfaces(
      interfaces,
      interfaceDraft,
      selectedInterfaceId,
      interfaceStatuses,
    );
  return `<div class="settings-list"><article><div><h3>Position history</h3><p>Keep activity in memory for the last 60 minutes.</p></div><span class="enabled-badge">60 min</span></article><article><div><h3>Map tile source</h3><p>OpenStreetMap standard tiles.</p></div><span class="enabled-badge">OSM</span></article><article class="config-path"><div><h3>Configuration file</h3><p data-config-path>Loading configuration path…</p></div></article></div>`;
}

function renderStationForm(
  stationSettings: StationSettings,
  locationAccuracy: string | undefined,
  phgCalculatorOpen: boolean,
  phgValues: PhgValues,
): string {
  const ssidOptions = Array.from(
    { length: 16 },
    (_, index) =>
      `<option ${stationSettings.ssid === `-${index}` ? 'selected' : ''}>-${index}</option>`,
  ).join('');
  return `<form class="configuration-form station-form"><div class="form-grid"><label>Callsign<input data-station-field="callsign" value="${stationSettings.callsign}" aria-label="Callsign" /></label><label>SSID<select data-station-field="ssid" aria-label="SSID">${ssidOptions}</select></label><label class="form-span-2">Location<div class="input-with-action"><input data-station-field="location" data-location-input value="${stationSettings.location}" aria-label="Latitude, longitude" /><button data-action="get-location" type="button" aria-label="Get system location" title="Get system location"><img src="${locationIcon}" alt="" /></button></div><div class="location-actions"><button class="outline-button" data-action="get-location" type="button">Get System Location</button><button class="outline-button" data-action="open-location-picker" type="button">Pick on Map</button>${locationAccuracy ? `<small>${locationAccuracy}</small>` : ''}</div></label><label class="form-span-2">Comment<div class="input-with-action"><input data-station-field="comment" data-comment-input value="${stationSettings.comment}" maxlength="36" aria-label="Comment" /><button data-action="open-phg" type="button" aria-label="Open PHG calculator" title="PHG calculator"><img src="${calculatorIcon}" alt="" /></button></div><small class="field-count"><span data-comment-count>${stationSettings.comment.length}</span>/36</small></label><label class="form-span-2">Status<input data-station-field="status" data-status-input value="${stationSettings.status}" maxlength="62" aria-label="Status" /><small class="field-count"><span data-status-count>${stationSettings.status.length}</span>/62</small></label><label>Beacon interval<select data-station-field="beaconInterval" aria-label="Beacon interval">${['15 minutes', '30 minutes', '60 minutes'].map((interval) => `<option ${stationSettings.beaconInterval === interval ? 'selected' : ''}>${interval}</option>`).join('')}</select></label><label>Status interval<select data-station-field="statusInterval" aria-label="Status interval">${['30 minutes', '60 minutes', '120 minutes'].map((interval) => `<option ${stationSettings.statusInterval === interval ? 'selected' : ''}>${interval}</option>`).join('')}</select></label></div><div class="form-actions"><button class="primary-button" data-action="save-station" type="button">Save station</button></div></form>${phgCalculatorOpen ? renderPhgCalculator(phgValues) : ''}`;
}

function renderPhgCalculator(values: PhgValues): string {
  const code = `${values.power}${values.height}${values.gain}${values.direction}`;
  return `<div class="modal-backdrop"><section class="phg-dialog" role="dialog" aria-modal="true" aria-labelledby="phg-title"><div class="dialog-header"><div><h3 id="phg-title">PHG calculator</h3><p>Power, antenna height, gain and directivity.</p></div><button data-action="close-phg" type="button" aria-label="Close PHG calculator">×</button></div><div class="form-grid"><label>Power<select data-phg-field="power">${['0 W', '1 W', '4 W', '9 W', '16 W', '25 W', '36 W', '49 W', '64 W', '81 W'].map((label, index) => `<option value="${index}" ${values.power === String(index) ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Height above average terrain<select data-phg-field="height">${['10 ft', '20 ft', '40 ft', '80 ft', '160 ft', '320 ft', '640 ft', '1280 ft', '2560 ft', '5120 ft'].map((label, index) => `<option value="${index}" ${values.height === String(index) ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label>Antenna gain<select data-phg-field="gain">${Array.from({ length: 10 }, (_, index) => `<option value="${index}" ${values.gain === String(index) ? 'selected' : ''}>${index} dBi</option>`).join('')}</select></label><label>Directivity<select data-phg-field="direction">${['Omnidirectional', '45°', '90°', '135°', '180°', '225°', '270°', '315°', '360°', 'Reserved'].map((label, index) => `<option value="${index}" ${values.direction === String(index) ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><div class="phg-preview">PHG${code}</div><div class="form-actions"><button class="outline-button" data-action="close-phg" type="button">Cancel</button><button class="primary-button" data-action="apply-phg" data-phg-code="PHG${code}" type="button">Insert PHG</button></div></section></div>`;
}

function renderInterfaces(
  interfaces: InterfaceSettings[],
  draft: InterfaceSettings,
  selectedInterfaceId: string | undefined,
  interfaceStatuses: Record<string, InterfaceConnectionStatus>,
): string {
  const rows = interfaces.length
    ? interfaces
        .map((item) => {
          const status = interfaceStatuses[item.id] ?? 'disconnected';
          const isConnected = status === 'connected';
          return `<div class="configured-interface ${selectedInterfaceId === item.id ? 'is-selected' : ''}"><button class="interface-name" data-interface="${item.id}" type="button"><strong>${escapeHtml(item.name || 'Unnamed interface')} <span>(${escapeHtml(item.type === 'kiss-tcp' ? item.hostPort || 'KISS TCP' : item.serialDevice || 'KISS Serial')})</span></strong></button><span class="interface-indicator ${isConnected ? 'is-enabled' : 'is-disabled'}" title="${status}"><img src="${isConnected ? checkIcon : closeIcon}" alt="" /></span><span class="interface-indicator ${item.txBlocked ? 'is-blocked' : 'is-enabled'}" title="${item.txBlocked ? 'TX blocked' : 'TX enabled'}"><img src="${item.txBlocked ? lockIcon : lockOpenIcon}" alt="" /></span><span class="interface-actions"><button class="icon-action-button" data-action="toggle-interface" data-interface-id="${item.id}" type="button" title="${item.enabled ? 'Disable interface' : 'Enable interface'}"><img src="${item.enabled ? pauseIcon : playIcon}" alt="" /></button><button class="icon-action-button is-danger" data-action="request-delete-interface" data-interface-id="${item.id}" type="button" title="Delete interface"><img src="${deleteIcon}" alt="" /></button></span></div>`;
        })
        .join('')
    : `<p class="empty-interface-list">No interfaces configured.</p>`;
  const transportFields =
    draft.type === 'kiss-tcp'
      ? `<label class="form-span-2">Host / port<input data-interface-field="hostPort" value="${escapeAttribute(draft.hostPort)}" placeholder="127.0.0.1:8001" aria-label="Host and port" /></label>`
      : `<label>Serial device<input data-interface-field="serialDevice" value="${escapeAttribute(draft.serialDevice)}" placeholder="/dev/ttyUSB0 or COM3" aria-label="Serial device" /></label><label>Baud rate<select data-interface-field="baudRate" aria-label="Baud rate">${['1200', '2400', '4800', '9600', '19200', '38400', '57600', '115200'].map((rate) => `<option ${draft.baudRate === rate ? 'selected' : ''}>${rate}</option>`).join('')}</select></label>`;
  return `<div class="interfaces-workspace"><section class="interface-list"><div class="interface-list-header"><span>Interface list</span><button data-action="new-interface" type="button" aria-label="Add interface" title="Add interface"><img src="${plusIcon}" alt="" /></button></div><div class="interface-table-header"><span>Name</span><span>Status</span><span>TX control</span><span>Actions</span></div>${rows}</section><form class="configuration-form interface-form"><div class="form-heading"><h3>${selectedInterfaceId ? 'Edit interface' : 'Add interface'}</h3><span class="type-pill">${draft.type === 'kiss-tcp' ? 'KISS TCP' : 'KISS Serial'}</span></div><div class="form-grid"><label>Name<input data-interface-field="name" value="${escapeAttribute(draft.name)}" maxlength="80" aria-label="Interface name" /></label><label>Type<select data-interface-field="type" aria-label="Interface type"><option value="kiss-tcp" ${draft.type === 'kiss-tcp' ? 'selected' : ''}>KISS TCP</option><option value="kiss-serial" ${draft.type === 'kiss-serial' ? 'selected' : ''}>KISS Serial</option></select></label>${transportFields}<label>Reconnect timeout (s)<input data-interface-field="reconnectTimeout" value="${escapeAttribute(draft.reconnectTimeout)}" inputmode="numeric" aria-label="Reconnect timeout in seconds" /></label><label class="checkbox-field"><input data-interface-field="enabled" type="checkbox" ${draft.enabled ? 'checked' : ''} /> Enabled</label></div><label class="checkbox-field tx-block"><input data-interface-field="txBlocked" type="checkbox" ${draft.txBlocked ? 'checked' : ''} /> Block TX on this interface</label><div class="form-actions"><button class="outline-button" data-action="new-interface" type="button">New interface</button><button class="primary-button" data-action="save-interface" type="button">Save interface</button></div></form></div>`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;',
      })[character] ?? character,
  );
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}
