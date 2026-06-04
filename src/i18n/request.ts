import { getRequestConfig } from "next-intl/server";
import { cookies } from "next/headers";
import en from "../../messages/en.json";
import fr from "../../messages/fr.json";

const messagesByLocale = {
  en,
  fr,
} as const;

type AppLocale = keyof typeof messagesByLocale;

function resolveLocale(raw: string | undefined): AppLocale {
  // French-first platform ("100 % francophone sans compromis"): default to FR.
  // English is opt-in via the language toggle, which sets NEXT_LOCALE=en. This
  // ensures a fresh visitor (no cookie) sees French everywhere — including the
  // server-rendered page-load spinner (app/loading.tsx).
  if (raw === "en") return "en";
  return "fr";
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveLocale(cookieStore.get("NEXT_LOCALE")?.value);

  return {
    locale,
    messages: messagesByLocale[locale],
  };
});
