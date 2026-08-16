import { getOrderFormData } from "@/lib/orders/getOrderFormData";
import { OrderForm } from "@/components/orders/OrderForm";

export default async function DirectShipOrderPage() {
  const { accounts, locations, skus } = await getOrderFormData();
  return (
    <OrderForm
      orderType="direct_ship"
      title="Direct Ship Order"
      defaultOrderLineText="Direct Ship Order"
      accounts={accounts}
      locations={locations}
      skus={skus}
    />
  );
}
