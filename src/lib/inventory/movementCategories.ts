import type { MovementCategory } from "@/lib/supabase/database.types";

export const CATEGORY_LABELS: Record<MovementCategory, string> = {
  purchase_in: "Purchase In",
  dc_out: "Sent to Hospital",
  dc_return_in: "Returned from Hospital",
  sale_out: "Sold",
  material_in: "Material In",
  material_out: "Material Out",
};

export const MOVEMENT_CATEGORY_KEYS = Object.keys(CATEGORY_LABELS) as MovementCategory[];

export const HOSPITAL_CATEGORIES: MovementCategory[] = ["dc_out", "dc_return_in"];

// Accepts either the human label ("Sent to Hospital") or the raw enum key
// ("dc_out"), case-insensitive -- a hand-filled sheet could reasonably have
// either, and the template's dropdown writes the human label.
export function parseCategoryLabel(raw: string): MovementCategory | null {
  const norm = raw.trim().toLowerCase();
  for (const key of MOVEMENT_CATEGORY_KEYS) {
    if (key.toLowerCase() === norm || CATEGORY_LABELS[key].toLowerCase() === norm) return key;
  }
  return null;
}
