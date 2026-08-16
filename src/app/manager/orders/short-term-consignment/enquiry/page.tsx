import { redirect } from "next/navigation";

export default function ShortTermConsignmentEnquiryPage() {
  redirect("/manager/orders/enquiry?type=short_term_consignment");
}
