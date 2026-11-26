const TOOLTIP_DELAY_MS = 250;

/** Replace native title popups with a consistent, faster tooltip. */
export function installTooltips(): void {
  const tooltip = document.createElement('div');
  tooltip.className = 'app-tooltip';
  tooltip.setAttribute('role', 'tooltip');
  tooltip.hidden = true;
  document.body.append(tooltip);
  let target: Element | undefined;
  let title = '';
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stationLabelVisible = (element: Element) =>
    element.matches('.aprs-marker-wrapper') &&
    !!element.closest('.aprs-map:not(.map-station-labels-hidden)');

  const hide = () => {
    clearTimeout(timer);
    tooltip.hidden = true;
    if (target?.isConnected && !target.hasAttribute('data-station-tooltip') && !target.hasAttribute('title')) target.setAttribute('title', title);
    target = undefined;
    title = '';
  };
  const show = (element: Element) => {
    if (target === element) return;
    hide();
    if (stationLabelVisible(element)) return;
    const value = element.getAttribute('data-station-tooltip') ?? element.getAttribute('title');
    if (!value?.trim()) return;
    target = element;
    title = value;
    element.removeAttribute('title');
    timer = setTimeout(() => {
      if (!target?.isConnected || stationLabelVisible(target)) { hide(); return; }
      tooltip.textContent = title;
      tooltip.hidden = false;
      const rect = target.getBoundingClientRect();
      const box = tooltip.getBoundingClientRect();
      const left = Math.max(8, Math.min(window.innerWidth - box.width - 8, rect.left + (rect.width - box.width) / 2));
      const top = rect.bottom + 8 + box.height <= window.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - box.height - 8);
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }, TOOLTIP_DELAY_MS);
  };
  document.addEventListener('mouseover', (event) => {
    if (!(event.target instanceof Element)) return;
    if (target?.contains(event.target)) return;
    const element = event.target.closest('[title], [data-station-tooltip]');
    if (element) show(element);
    else hide();
  });
  document.addEventListener('mouseout', (event) => {
    if (target && event.relatedTarget instanceof Node && target.contains(event.relatedTarget)) return;
    hide();
  });
  document.addEventListener('focusin', (event) => {
    if (event.target instanceof Element) {
      const element = event.target.closest('[title], [data-station-tooltip]');
      if (element) show(element);
    }
  });
  document.addEventListener('focusout', hide);
  document.addEventListener('pointerdown', hide);
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') hide(); });
  document.addEventListener('scroll', hide, true);
  window.addEventListener('blur', hide);
  window.addEventListener('aprs-map:label-visibility', () => {
    if (target && stationLabelVisible(target)) hide();
  });
}
