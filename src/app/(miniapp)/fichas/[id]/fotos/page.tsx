import { PhotosScreen } from "@/miniapp/photos-screen";

export default async function ListingPhotosPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PhotosScreen listingId={id} />;
}
