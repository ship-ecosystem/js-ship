/** No dependencies: this module is also copied into generated Docker build guards. */
export function nodeRuntimeProblem(version: string, minimums: Readonly<Record<string, string>>): string | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?![\s\S])/.exec(version);
  const parts = match?.slice(1).map(Number);
  const minimum = parts && Object.hasOwn(minimums, String(parts[0])) ? minimums[String(parts[0])] : undefined;
  const message = `Node ${version} does not meet Ship's runtime policy. Use ${Object.values(minimums).map(value => `${value}+ in its major`).join(', ')}. Upgrade Node before using Ship.`;
  if (!parts || parts.some(value => !Number.isSafeInteger(value)) || !minimum) return message;
  const floor = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (parts[i]! > floor[i]!) return null;
    if (parts[i]! < floor[i]!) return message;
  }
  return null;
}
