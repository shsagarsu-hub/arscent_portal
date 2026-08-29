import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const ALLOWED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 10 * 1024 * 1024;

/** Shared upload endpoint for both invoice kinds an account manager attaches
 * -- a Saleable order's sales invoice, and one consignment usage entry's
 * invoice -- since both are just "AM uploads a PDF/image, gets back a
 * public URL" with the same auth and validation. `kind` only picks the
 * storage path prefix so the two don't collide in the bucket. */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (!profile || (profile.role !== "account_manager" && profile.role !== "admin")) {
    return Response.json({ error: "Not authorized." }, { status: 403 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const kind = formData.get("kind");
  if (!(file instanceof File)) {
    return Response.json({ error: "No file uploaded." }, { status: 400 });
  }
  if (kind !== "sales" && kind !== "usage") {
    return Response.json({ error: "Invalid invoice kind." }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return Response.json({ error: "Only PDF, JPEG, PNG, or WEBP files are accepted." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "File is too large (10MB max)." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${kind}/${crypto.randomUUID()}.${ext}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage.from("invoices").upload(path, buffer, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) {
    return Response.json({ error: uploadError.message }, { status: 500 });
  }

  const { data: publicUrl } = admin.storage.from("invoices").getPublicUrl(path);
  return Response.json({ url: publicUrl.publicUrl, name: file.name });
}
