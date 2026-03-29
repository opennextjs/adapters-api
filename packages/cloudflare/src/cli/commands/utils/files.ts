import fs from "node:fs";
import path from "node:path";

export function conditionalAppendFileSync(
	filepath: string,
	text: string,
	{
		appendIf = () => true,
		appendPrefix = "",
	}: {
		appendIf?: (fileContent: string) => boolean;
		appendPrefix?: string;
	} = {}
): void {
	const fileExists = fs.existsSync(filepath);
	const maybeFileContent = fileExists ? fs.readFileSync(filepath, "utf8") : "";

	if (!fileExists) {
		const dir = path.dirname(filepath);
		fs.mkdirSync(dir, { recursive: true });
	}

	if (!fileExists || appendIf(maybeFileContent)) {
		fs.appendFileSync(filepath, `${maybeFileContent.length > 0 ? appendPrefix : ""}${text}`);
	}
}
