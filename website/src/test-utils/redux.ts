import { REMEMBER_REHYDRATED } from 'redux-remember';

export function initAction() {
  return {
    type: 'INIT' as const,
    payload: null,
  };
}

export function rehydrateAction() {
  return {
    type: REMEMBER_REHYDRATED,
    payload: null,
  } as const;
}
