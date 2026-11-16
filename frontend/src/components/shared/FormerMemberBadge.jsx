import { UserX } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// The assignee's account no longer exists (decision 15 Nov 2026): a badge instead of the
// initials, so nobody reads the step as "somebody is on it". Red and filled, not grey (amber is the external contact)
// (Richard 16 Nov 2026: nobody works on the step although somebody should — it must stand
// out). `compact` = icon only, for
// narrow columns; the bubble always carries the address the step is still assigned to.
export default function FormerMemberBadge({ email, compact = false, className = '' }) {
  const { t } = useTranslation('nav');
  const title = t('formerMember.hint', { email });
  if (compact) {
    return (
      <span
        className={`w-6 h-6 rounded-full border border-red-700 bg-red-600 text-white inline-flex items-center justify-center ${className}`}
        title={title}
        data-testid="byvaly-clen"
      >
        <UserX className="w-3.5 h-3.5" />
      </span>
    );
  }
  return (
    <span
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border border-red-700 bg-red-600 text-white max-w-[11rem] ${className}`}
      title={title}
      data-testid="byvaly-clen"
    >
      <UserX className="w-2.5 h-2.5 shrink-0" />
      <span className="truncate">{t('formerMember.badge')}</span>
    </span>
  );
}
