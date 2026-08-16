import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/Wordmark";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-cream p-6 text-center">
        <Wordmark size="lg" />
        <div className="card max-w-md">
          <h3 className="mb-1 text-[14.5px] font-extrabold text-ink">No profile set up yet</h3>
          <p className="text-[12.5px] text-muted">
            Your account ({user.email}) is signed in but has no role assigned. Ask an account
            manager to add you in the Accounts screen.
          </p>
        </div>
        <form action="/auth/sign-out" method="post">
          <button className="btn-outline-danger" type="submit">
            Sign out
          </button>
        </form>
      </div>
    );
  }

  if (profile.role === "hospital") redirect("/hospital");
  redirect("/manager");
}
