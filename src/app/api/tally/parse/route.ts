import { createClient } from "@/lib/supabase/server";
import { parseTallyInvoicePdf } from "@/lib/tally/parsePdf";

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
  if (file.type !== "application/pdf") {
    return Response.json({ error: "That's not a PDF file." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await parseTallyInvoicePdf(buffer);
    if (result.lines.length === 0) {
      return Response.json(
        { error: "Couldn't find any invoice line items in this PDF.", warnings: result.warnings },
        { status: 422 }
      );
    }
    return Response.json(result);
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Failed to parse the PDF." },
      { status: 500 }
    );
  }
}
