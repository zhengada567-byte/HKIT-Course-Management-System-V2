import { useLanguage } from "../../contexts/LanguageContext";

interface EmptyStateProps {
  message?: string;
}

export function EmptyState({ message }: EmptyStateProps) {
  const { t } = useLanguage();

  return (
    <div className="flex min-h-32 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
      {message ?? t.noData}
    </div>
  );
}
