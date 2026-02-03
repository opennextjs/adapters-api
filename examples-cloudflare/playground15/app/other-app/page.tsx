"use client";
import Image from "next/image";

import testImage from "../../public/test.jpg";

export default function Page() {
	return (
		<>
			<h1>other app</h1>
			<Image src={testImage} alt="test" />
			<p id="deploymentId">{process.env.NEXT_DEPLOYMENT_ID}</p>

			<button
				onClick={() => {
					import("../../data").then((mod) => {
						console.log("loaded data", mod);
					});
				}}
				id="dynamic-import"
			>
				click me
			</button>
		</>
	);
}
