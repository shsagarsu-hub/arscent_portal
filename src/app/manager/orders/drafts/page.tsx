import { ComingSoon } from "@/components/orders/ComingSoon";

export default function DraftManagerPage() {
  return (
    <ComingSoon
      title="Draft Manager"
      note="Saving an in-progress order as a draft and resuming it later isn't wired up yet — every order form currently submits in one pass or discards on Cancel."
    />
  );
}
