import { redirect } from "next/navigation";

/**
 * The bare domain. Deployments that put this on a domain which already has a
 * home page can send visitors there with ROOT_REDIRECT_URL; everyone else gets
 * the parent app, which is the only thing at the root.
 *
 * Deliberately a temporary redirect: a permanent one is cached by browsers for
 * a long time, which would be awkward to undo if this domain later gains a
 * landing page of its own.
 */
// Without this the route has no dynamic input, so Next resolves the redirect
// at build time and bakes in whatever the variable was then — which is nothing,
// since it is set on the deployment rather than in the build.
export const dynamic = "force-dynamic";

export default function Home() {
  redirect(process.env.ROOT_REDIRECT_URL || "/parent");
}
