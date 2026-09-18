import Dashboard from './dashboard';
import { readDataset } from '@/lib/dashboard-snapshot';
import type { DashboardData } from '@/lib/fpl-data';

// Cache the rendered homepage as well as its underlying shared snapshot.
export const revalidate = 300;

export default async function Home() {
  const { body, source } = await readDataset('fpl');
  return <Dashboard initialData={JSON.parse(body) as DashboardData} initialSource={source} />;
}
