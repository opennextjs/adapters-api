import { getSong } from "examples-cloudflare/e2e-shared/api";
import Modal from "examples-cloudflare/e2e-shared/components/Modal";

type Props = {
	params: Promise<{
		album: string;
		song: string;
	}>;
};
export default async function SongPage(props: Props) {
	const params = await props.params;
	const song = await getSong(params.album, params.song);
	return (
		<Modal>
			<h1>Modal</h1>
			Album: {decodeURIComponent(params.album)}
			<div className="absolute top-1/2 mt-10">
				{/* <video width={1000} height={1000} autoPlay src={`https://youtube.com/watch?v=${params.song}`} /> */}
				<iframe
					width="560"
					height="315"
					title={params.song}
					allowFullScreen
					src={`https://youtube.com/embed/${song?.videoId}?autoplay=1`}
				></iframe>
			</div>
		</Modal>
	);
}
