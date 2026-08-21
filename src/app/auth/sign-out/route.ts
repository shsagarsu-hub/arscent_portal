import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  // 303, not the default 307 -- a 307 preserves the original request's
  // method on the redirect, so the browser would re-issue this as a POST
  // to /login, which has no POST handler (it's a page, not a route),
  // producing a 405. 303 explicitly tells the browser to follow up with
  // GET regardless of the original method -- the standard
  // POST-then-redirect-to-GET pattern.
  return NextResponse.redirect(new URL("/login", request.url), 303);
}
