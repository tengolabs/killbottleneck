import { callFlowmapRoute } from './flowmapApi';

export const shareMap = (payload) => callFlowmapRoute('/api/kb/share', payload);
