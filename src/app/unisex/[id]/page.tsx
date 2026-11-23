import UnisexView from "@/components/UnisexView";
export const dynamic = "force-dynamic";
export default async function UnisexRunPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <UnisexView id={Number(id)} />; }
