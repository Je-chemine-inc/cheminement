import { Cog } from "lucide-react";
import { getTranslations } from "next-intl/server";

// Root route-loading boundary (the page-load spinner). Localized so the wait
// text follows the active locale ("Chargement..." in FR) instead of hardcoded
// English. Same server-side next-intl pattern as the Footer.
export default async function Loading() {
  const t = await getTranslations("Common");
  return (
    <div className="h-screen flex flex-col justify-center items-center">
      <span className="text-2xl font-bold">{t("loading")}</span>
      <Cog className="animate-spin h-10 w-10 text-gray-500" />
    </div>
  );
}
