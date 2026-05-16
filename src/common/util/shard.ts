function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);

    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }

  return hash >>> 0;
}

export function shardOf(key: string, shardCount: number): number {
  if (!Number.isInteger(shardCount) || shardCount <= 0) {
    throw new Error(`shardCount must be a positive integer, got ${shardCount}`);
  }

  return fnv1a32(key) % shardCount;
}

export function shouldHandle(
  key: string,
  shardIndex: number | undefined,
  shardCount: number | undefined,
): boolean {
  if (shardIndex === undefined || shardCount === undefined) {
    return true;
  }

  return shardOf(key, shardCount) === shardIndex;
}
