import { Suspense } from "react";

import { DynamicComponent } from "@/components/dynamic";
import { StaticComponent } from "@/components/static";

export const experimental_ppr = true;

export default function PPRPage() {
	return (
		<div>
			<StaticComponent />
			<Suspense fallback={<div>Loading...</div>}>
				<DynamicComponent />
			</Suspense>
		</div>
	);
}
