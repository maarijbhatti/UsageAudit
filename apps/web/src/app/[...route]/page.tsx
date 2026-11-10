import { Workspace } from "../../features/workspace";
export default async function Page({
  params,
}: {
  params: Promise<{ route: string[] }>;
}) {
  const { route } = await params;
  return <Workspace route={route} />;
}
