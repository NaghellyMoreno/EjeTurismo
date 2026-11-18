import { ListingFormScreen } from "@/miniapp/listing-form-screen";

export default async function EditListingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ListingFormScreen listingId={id} />;
}
