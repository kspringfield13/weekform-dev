import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { isProtectedWebPath } from "../protectedPaths";
import { buildContentSecurityPolicy } from "../securityPolicy";
import { getSupabaseEnv } from "./config";

const AUTH_REDIRECT_PAGES = ["/signup"];

/**
 * Session refresh + route protection, per the official Supabase SSR pattern.
 *
 * IMPORTANT: the response returned here carries refreshed auth cookies.
 * Always return `supabaseResponse` (or copy its cookies onto any redirect)
 * so the browser and server never hold divergent sessions.
 */
export async function updateSession(request: NextRequest) {
  // A unique request nonce lets Next apply a strict script policy to framework
  // and application scripts. The same policy is forwarded into rendering and
  // returned to the browser; no nonce is persisted or logged.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy({
    development: process.env.NODE_ENV !== "production",
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    nonce,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const nextResponse = () => {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return response;
  };
  const secureResponse = <T extends NextResponse>(response: T): T => {
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return response;
  };

  let supabaseResponse = nextResponse();

  const env = getSupabaseEnv();
  if (!env) {
    // No Supabase project configured: let pages render their honest
    // "not configured" states instead of redirect-looping.
    return supabaseResponse;
  }

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value),
        );
        supabaseResponse = nextResponse();
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Do not run code between createServerClient and auth.getUser();
  // doing so can cause hard-to-debug session drops.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  const isProtected = isProtectedWebPath(pathname);
  const isAuthRedirectPage = AUTH_REDIRECT_PAGES.some(
    (page) => pathname === page || pathname.startsWith(`${page}/`),
  );

  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie.name, cookie.value);
    });
    return secureResponse(redirect);
  }

  if (user && isAuthRedirectPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie.name, cookie.value);
    });
    return secureResponse(redirect);
  }

  return supabaseResponse;
}
