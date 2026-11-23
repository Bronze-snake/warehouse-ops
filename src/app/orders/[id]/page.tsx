import WaveView from "@/components/WaveView";
export const dynamic = "force-dynamic";
export default async function WavePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <WaveView id={Number(id)} />; }
