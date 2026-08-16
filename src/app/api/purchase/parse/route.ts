import { createClient } from "@/lib/supabase/server";
import { parsePurchaseExcel } from "@/lib/tally/parsePurchaseExcel";

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return Response.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || profile.role === "hospital") {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
    return Response.json({ error: "That's not an Excel file (.xlsx or .xlsm)." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "File is too large (10MB max)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await parsePurchaseExcel(buffer);
    if (result.rows.length === 0) {
      return Response.json(
        { error: "Couldn't find any batch rows in this file.", warnings: result.warnings },
        { status: 422 }
      );
    }
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to parse the file." },
      { status: 500 }
    );
  }
}
