import { getOrderFormData } from "@/lib/orders/getOrderFormData";
import { OrderForm } from "@/components/orders/OrderForm";

export default async function CapitalSalesOrderPage() {
  const { accounts, locations, skus } = await getOrderFormData();
  return (
    <OrderForm
      orderType="capital_sales"
      title="Capital Sales Order"
      defaultOrderLineText="Capital Sales Order"
      accounts={accounts}
      locations={locations}
      skus={skus}
    />
  );
}
