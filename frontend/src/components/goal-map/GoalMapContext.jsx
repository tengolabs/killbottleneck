import { createContext, useContext } from 'react';

const GoalMapContext = createContext(null);

export const useGoalMap = () => useContext(GoalMapContext);

export default GoalMapContext;