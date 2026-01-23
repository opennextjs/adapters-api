import Modal from "examples-cloudflare/e2e-shared/components/Modal";

type Props = {
	params: Promise<{
		artist: string;
	}>;
};
export default async function ArtistPage(props: Props) {
	const params = await props.params;
	return <Modal>Artists {params.artist}</Modal>;
}
