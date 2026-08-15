import { callFlowmapRoute } from './flowmapApi';

export const getPublicMap = (payload) => callFlowmapRoute('/api/kb/public-maps', payload);
