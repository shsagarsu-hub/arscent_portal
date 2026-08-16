import { getOrderFormData } from "@/lib/orders/getOrderFormData";
import { OrderForm } from "@/components/orders/OrderForm";

export default async function ShortTermConsignmentOrderPage() {
  const { accounts, locations, skus } = await getOrderFormData();
  return (
    <OrderForm
      orderType="short_term_consignment"
      title="Short Term Consignment Order Entry"
      defaultOrderLineText="Short Term Consignment Order"
      accounts={accounts}
      locations={locations}
      skus={skus}
    />
  );
}
