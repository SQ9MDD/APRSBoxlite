export function parseMessageControl(text: string): { control: 'ack' | 'rej'; number: string } | undefined {
  const match = text.trim().match(/^(ack|rej)([A-Z0-9]{1,5})(?:}[A-Z0-9]{0,5})?$/i);
  if (!match) return undefined;
  return { control: match[1].toLowerCase() === 'ack' ? 'ack' : 'rej', number: match[2].toUpperCase() };
}
