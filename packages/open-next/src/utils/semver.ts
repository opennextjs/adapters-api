export type SemverOp = "=" | ">=" | "<=" | ">" | "<";

export function compareSemver(v1: string, operator: SemverOp, v2: string): boolean {
	let versionDiff = 0;
	if (v1 === "latest") {
		versionDiff = 1;
	} else {
		if (/^[^\d]/.test(v1)) {
			v1 = v1.substring(1);
		}
		if (/^[^\d]/.test(v2)) {
			v2 = v2.substring(1);
		}
		const [major1, minor1 = 0, patch1 = 0] = v1.split(".").map(Number);
		const [major2, minor2 = 0, patch2 = 0] = v2.split(".").map(Number);
		if (Number.isNaN(major1) || Number.isNaN(major2)) {
			throw new Error("The major version is required.");
		}

		if (major1 !== major2) {
			versionDiff = major1 - major2;
		} else if (minor1 !== minor2) {
			versionDiff = minor1 - minor2;
		} else if (patch1 !== patch2) {
			versionDiff = patch1 - patch2;
		}
	}

	switch (operator) {
		case "=":
			return versionDiff === 0;
		case ">=":
			return versionDiff >= 0;
		case "<=":
			return versionDiff <= 0;
		case ">":
			return versionDiff > 0;
		case "<":
			return versionDiff < 0;
		default:
			throw new Error(`Unsupported operator: ${operator}`);
	}
}
