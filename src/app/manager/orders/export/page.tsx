import { getOrderFormData } from "@/lib/orders/getOrderFormData";
import { OrderForm } from "@/components/orders/OrderForm";

export default async function ExportOrderPage() {
  const { accounts, locations, skus } = await getOrderFormData();
  return (
    <OrderForm
      orderType="export"
      title="Export Order"
      defaultOrderLineText="Export Order"
      accounts={accounts}
      locations={locations}
      skus={skus}
    />
  );
}
