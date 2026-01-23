import { getAlbums } from "examples-cloudflare/e2e-shared/api";
import Album from "examples-cloudflare/e2e-shared/components/Album";

export default async function AlbumPage() {
	const albums = await getAlbums();
	return (
		<div>
			{albums.map((album) => (
				<Album album={album} />
			))}
		</div>
	);
}
