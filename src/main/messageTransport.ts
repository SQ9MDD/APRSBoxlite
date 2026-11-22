export interface MessageInterface {
  id: string;
  name: string;
  enabled: boolean;
  txBlocked: boolean;
}

export function availableMessageInterfaces<T extends MessageInterface>(interfaces: T[], canTransmit: (item: T) => boolean): T[] {
  return interfaces.filter((item) => item.enabled && !item.txBlocked && canTransmit(item));
}

export async function sendMessageOnInterfaces<T extends MessageInterface>(
  interfaces: T[], frame: Uint8Array, transmit: (id: string, frame: Uint8Array) => Promise<void>,
): Promise<Array<{ interface: T; error: string }>> {
  if (!interfaces.length) throw new Error('No connected transmit interface is available for the message.');
  const results = await Promise.allSettled(interfaces.map((item) => Promise.resolve().then(() => transmit(item.id, frame))));
  const failures: Array<{ interface: T; error: string }> = [];
  let successes = 0;
  results.forEach((result, index) => {
    if (result.status === 'fulfilled') successes++;
    else failures.push({ interface: interfaces[index], error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
  });
  if (!successes) throw new Error(`Message transmission failed: ${failures.map(({ interface: item, error }) => `${item.name || item.id}: ${error}`).join('; ')}`);
  return failures;
}
