import { useLanguage } from "../../contexts/LanguageContext";

export function LoadingState() {
  const { t } = useLanguage();

  return (
    <div className="flex min-h-40 items-center justify-center text-sm text-slate-500">
      {t.loading}
    </div>
  );
}
