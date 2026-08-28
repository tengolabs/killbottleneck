import { Loader2 } from 'lucide-react';

// Ikona tlačítka, která se při práci vymění za spinner — jeden zápis místo
// `{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ikona className="w-4 h-4" />}`
// opsaného ve 20 dialozích (F4-07).
export default function BusyIcon({ busy, icon: Icon, className = 'w-4 h-4' }) {
  if (busy) return <Loader2 className={`${className} animate-spin`} />;
  return Icon ? <Icon className={className} /> : null;
}
