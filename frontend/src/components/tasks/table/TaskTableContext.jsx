import { createContext, useContext } from 'react';

// F3-07: TaskTable měl 32 props, z nichž 8 (uzel) + 7 (úkol) + 3 (zásobník) se jen
// prodrátovávaly do řádků. Handlery a sdílená data (members, meEmail, commentCounts)
// proto řádky berou z tohoto kontextu — props řádků jsou už jen data.
const TaskTableContext = createContext(null);

export function useTaskTable() {
  const ctx = useContext(TaskTableContext);
  if (!ctx) throw new Error('useTaskTable() lze volat jen uvnitř <TaskTable> (chybí TaskTableContext.Provider)');
  return ctx;
}

export default TaskTableContext;
