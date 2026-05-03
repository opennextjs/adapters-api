import { DurableObject } from "cloudflare:workers";

import { debugCache } from "../overrides/internal.js";

export type TagData = {
	revalidatedAt: number;
	stale: number | null;
	expire: number | null;
};

export class DOShardedTagCache extends DurableObject<CloudflareEnv> {
	sql: SqlStorage;

	constructor(state: DurableObjectState, env: CloudflareEnv) {
		super(state, env);
		this.sql = state.storage.sql;
		state.blockConcurrencyWhile(async () => {
			this.sql.exec(
				`CREATE TABLE IF NOT EXISTS revalidations (tag TEXT PRIMARY KEY, revalidatedAt INTEGER, stale INTEGER, expire INTEGER DEFAULT NULL)`
			);
			try {
				this.sql.exec(
					`ALTER TABLE revalidations ADD COLUMN stale INTEGER; ALTER TABLE revalidations ADD COLUMN expire INTEGER DEFAULT NULL`
				);
			} catch {
				// The ALTER TABLE statement fails if the columns already exist.
			}
		});
	}

	async getTagData(tags: string[]): Promise<Record<string, TagData>> {
		if (tags.length === 0) return {};
		try {
			const result = this.sql
				.exec(
					`SELECT tag, revalidatedAt, stale, expire FROM revalidations WHERE tag IN (${tags.map(() => "?").join(", ")})`,
					...tags
				)
				.toArray();

			debugCache("DOShardedTagCache", `getTagData tags=${tags} -> ${result.length} results`);
			return Object.fromEntries(
				result.map((row) => [
					row.tag as string,
					{
						revalidatedAt: (row.revalidatedAt ?? 0) as number,
						stale: (row.stale ?? null) as number | null,
						expire: (row.expire ?? null) as number | null,
					},
				])
			);
		} catch (e) {
			console.error(e);
			return {};
		}
	}

	async getLastRevalidated(tags: string[]): Promise<number> {
		const data = await this.getTagData(tags);
		const values = Object.values(data);
		const timeMs = values.length === 0 ? 0 : Math.max(...values.map(({ revalidatedAt }) => revalidatedAt));
		debugCache("DOShardedTagCache", `getLastRevalidated tags=${tags} -> time=${timeMs}`);
		return timeMs;
	}

	async hasBeenRevalidated(tags: string[], lastModified?: number): Promise<boolean> {
		const data = await this.getTagData(tags);
		const lastModifiedOrNowMs = lastModified ?? Date.now();
		const revalidated = Object.values(data).some(({ revalidatedAt }) => revalidatedAt > lastModifiedOrNowMs);
		debugCache("DOShardedTagCache", `hasBeenRevalidated tags=${tags} -> revalidated=${revalidated}`);
		return revalidated;
	}

	async getRevalidationTimes(tags: string[]): Promise<Record<string, number>> {
		const data = await this.getTagData(tags);
		return Object.fromEntries(Object.entries(data).map(([tag, { revalidatedAt }]) => [tag, revalidatedAt]));
	}

	async writeTags(
		tags: Array<string | { tag: string; stale?: number; expire?: number | null }>,
		lastModified?: number
	): Promise<void> {
		if (tags.length === 0) return;
		const nowMs = lastModified ?? Date.now();
		debugCache("DOShardedTagCache", `writeTags tags=${JSON.stringify(tags)} time=${nowMs}`);

		if (typeof tags[0] === "string") {
			for (const tag of tags as string[]) {
				this.sql.exec(
					`INSERT OR REPLACE INTO revalidations (tag, revalidatedAt, stale) VALUES (?, ?, ?)`,
					tag,
					nowMs,
					nowMs
				);
			}
		} else {
			for (const entry of tags as Array<{ tag: string; stale?: number; expire?: number | null }>) {
				const staleValue = entry.stale ?? nowMs;
				this.sql.exec(
					`INSERT OR REPLACE INTO revalidations (tag, revalidatedAt, stale, expire) VALUES (?, ?, ?, ?)`,
					entry.tag,
					staleValue,
					staleValue,
					entry.expire ?? null
				);
			}
		}
	}
}
