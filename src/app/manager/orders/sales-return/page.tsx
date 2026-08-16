import { getOrderFormData } from "@/lib/orders/getOrderFormData";
import { OrderForm } from "@/components/orders/OrderForm";

export default async function SalesReturnOrderPage() {
  const { accounts, locations, skus } = await getOrderFormData();
  return (
    <OrderForm
      orderType="sales_return"
      title="Sales Return Order"
      defaultOrderLineText="Sales Return Order"
      accounts={accounts}
      locations={locations}
      skus={skus}
    />
  );
}
