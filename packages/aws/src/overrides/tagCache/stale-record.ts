type TagRecord = {
	revalidatedAt?: { N: string };
	stale?: { N: string };
	expire?: { N: string };
};

/**
 * Checks whether a tag record defines an active stale window for a cached entry.
 *
 * @param item Persisted tag timestamps.
 * @param lastModified Entry generation timestamp.
 * @param now Current time.
 * @return True only for a newer stale event whose expiry has not elapsed.
 */
export function isStaleRecord(item: TagRecord, lastModified: number, now: number): boolean {
	return (
		Number(item.revalidatedAt?.N) > lastModified &&
		Number(item.stale?.N) > lastModified &&
		(item.expire === undefined || Number(item.expire.N) > now)
	);
}
