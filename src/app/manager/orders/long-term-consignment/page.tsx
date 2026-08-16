import { getOrderFormData } from "@/lib/orders/getOrderFormData";
import { OrderForm } from "@/components/orders/OrderForm";

export default async function LongTermConsignmentOrderPage() {
  const { accounts, locations, skus } = await getOrderFormData();
  return (
    <OrderForm
      orderType="long_term_consignment"
      title="Long Term Consignment Order"
      defaultOrderLineText="Long Term Consignment Order"
      accounts={accounts}
      locations={locations}
      skus={skus}
    />
  );
}
