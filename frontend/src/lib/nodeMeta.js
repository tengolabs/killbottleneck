import { fmtDate } from '@/lib/locale';

export function getDeadlineStatus(deadline, status) {
  if (!deadline) return null;
  if (status === 'done') return 'normal';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dl = new Date(deadline + 'T00:00:00');
  dl.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dl - now) / 86400000);
  if (diffDays < 0) return 'overdue';
  if (diffDays <= 3) return 'upcoming';
  return 'normal';
}

export function getInitials(label) {
  // Bere e-mail I zobrazované jméno („Richard Pobříslo" → RP, „bagr" → BA).
  if (!label) return '';
  const zaklad = label.includes('@') ? label.split('@')[0] : label;
  const parts = zaklad.split(/[.\s_-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return zaklad.slice(0, 2).toUpperCase();
}

export function formatDeadline(deadline) {
  if (!deadline) return '';
  return fmtDate(deadline + 'T00:00:00', { day: 'numeric', month: 'short' });
}