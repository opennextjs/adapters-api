import { unstable_cache } from "next/cache";

import RevalidationButtons from "./components/revalidationButtons";
import styles from "./page.module.css";

const fetchedDateCb = unstable_cache(
	async () => {
		return Date.now();
	},
	["date"],
	{ tags: ["date"] }
);

export default async function Home() {
	const fetchedDate = await fetchedDateCb();
	return (
		<div className={styles.page}>
			<main className={styles.main}>
				<h1>Hello from a Statically generated page</h1>
				<p data-testid="date-local">{Date.now()}</p>
				<p data-testid="date-fetched">{fetchedDate}</p>

				<RevalidationButtons />
			</main>
		</div>
	);
}
