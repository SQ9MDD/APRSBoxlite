export function createConfigurationBackup(configuration: Record<string, unknown>): Record<string, unknown> {
  return { format: 'APRSBoxLite-configuration', version: 1, configuration: structuredClone(configuration) };
}

export function readConfigurationBackup(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid backup.');
  const backup = value as Record<string, unknown>;
  if (backup.format !== 'APRSBoxLite-configuration' || backup.version !== 1 || !backup.configuration || typeof backup.configuration !== 'object' || Array.isArray(backup.configuration)) throw new Error('This is not an APRSBox Lite configuration backup.');
  return structuredClone(backup.configuration as Record<string, unknown>);
}
