import { getOrderFormData } from "@/lib/orders/getOrderFormData";
import { OrderForm } from "@/components/orders/OrderForm";

export default async function SaleableOrderPage() {
  const { accounts, locations, skus } = await getOrderFormData();
  return (
    <OrderForm
      orderType="saleable"
      title="Saleable Order"
      defaultOrderLineText="Saleable Order"
      accounts={accounts}
      locations={locations}
      skus={skus}
    />
  );
}
