import { getOrderFormData } from "@/lib/orders/getOrderFormData";
import { ConsignmentConsumptionForm } from "@/components/orders/ConsignmentConsumptionForm";

export default async function ConsignmentConsumptionPage() {
  const { accounts, locations } = await getOrderFormData();
  return <ConsignmentConsumptionForm accounts={accounts} locations={locations} />;
}
