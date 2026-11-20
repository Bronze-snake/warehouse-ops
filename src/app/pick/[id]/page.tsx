import PickView from "@/components/PickView";
export const dynamic = "force-dynamic";
export default async function PickRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ existing?: string }> }) {
  const { id } = await params; const sp = await searchParams;
  return <PickView id={Number(id)} existing={sp.existing === "1"} />;
}
