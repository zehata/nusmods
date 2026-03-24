import { REMOVE_MODULE, SET_TIMETABLE } from 'actions/timetables';

import { State } from 'types/state';
import { Actions } from 'types/actions';

// Non-persisted reducers
import requests from './requests';
import app from './app';
import createUndoReducer from './undoHistory';

// Persisted reducers
import moduleBankReducer from './moduleBank';
import venueBankReducer from './venueBank';
import timetablesReducer from './timetables';
import themeReducer from './theme';
import settingsReducer from './settings';
import plannerReducer from './planner';
import { rememberReducer } from 'redux-remember';
import reduxRemember from './reduxRemember';
import { UndoHistoryState } from 'types/reducers';

// State default is delegated to its child reducers.
const defaultState = {} as unknown as State;
const undoReducer = createUndoReducer<State>({
  limit: 1,
  actionsToWatch: [REMOVE_MODULE, SET_TIMETABLE],
  storedKeyPaths: ['timetables', 'theme.colors'],
});

export default function reducer(state: State = defaultState, action: Actions): State {
  // Update every reducer except the undo reducer
  // const newState: State = {
  //   moduleBank: moduleBank(state.moduleBank, action),
  //   venueBank: venueBank(state.venueBank, action),
  //   requests: requests(state.requests, action),
  //   timetables: timetables(state.timetables, action),
  //   app: app(state.app, action),
  //   theme: theme(state.theme, action),
  //   settings: settings(state.settings, action),
  //   planner: planner(state.planner, action),
  //   undoHistory: state.undoHistory,
  // };
  const reducers = {
    moduleBank: moduleBankReducer,
    venueBank: venueBankReducer,
    requests,
    timetables: timetablesReducer,
    app,
    theme: themeReducer,
    settings: settingsReducer,
    planner: plannerReducer,
    reduxRemember: reduxRemember.reducer,
    undoHistory: (
      state: UndoHistoryState<State> = {
        past: [],
        present: undefined, // Don't pretend to know the present
        future: [],
      },
      _action: Actions,
    ) => state,
  };
  const reducer = rememberReducer(reducers);
  const newState = reducer(state, action);
  return undoReducer(state, newState, action);
}
