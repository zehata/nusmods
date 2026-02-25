import { act, getByText, screen, waitFor, waitForElementToBeRemoved } from '@testing-library/react';
import type { RenderOptions } from '@testing-library/react';
import { Provider } from 'react-redux';
import axios, { AxiosHeaders, AxiosResponse } from 'axios';
import { produce } from 'immer';

import type { Semester } from 'types/modules';
import type { Dispatch } from 'types/redux';

import { FETCH_MODULE, FETCH_MODULE_LIST } from 'actions/constants';
import { setTimetable } from 'actions/timetables';
import configureStore from 'bootstrapping/configure-store';
import config from 'config';
import { SUCCESS_KEY } from 'middlewares/requests-middleware';
import reducers from 'reducers';
import { mockDom, mockDomReset } from 'test-utils/mockDom';
import { initAction } from 'test-utils/redux';
import renderWithRouterMatch from 'test-utils/renderWithRouterMatch';

import { timetablePage, timetableShare } from 'views/routes/paths';

import { BFS1001, CS1010S, CS3216 } from '__mocks__/modules';
import modulesList from '__mocks__/moduleList.json';

import { TimetableContainerComponent } from './TimetableContainer';
import userEvent from '@testing-library/user-event';
import { addModuleInput } from 'views/elements';
import { first } from 'lodash';

const cs1010sResponse: AxiosResponse = {
  data: CS1010S,
  status: 200,
  statusText: 'Ok',
  headers: {},
  config: {
    headers: new AxiosHeaders(),
  },
};

const relevantStoreContents = {
  app: {
    activeSemester: 1,
  },
};

const initialState = reducers(undefined, initAction());

function make(
  location: string,
  options: {
    storeOverrides?: Partial<typeof relevantStoreContents>;
    renderOptions?: Omit<RenderOptions, 'queries'> | undefined;
  } = {},
) {
  const { store } = configureStore(
    produce(initialState, (draft) => {
      draft.app.activeSemester =
        options.storeOverrides?.app?.activeSemester ?? relevantStoreContents.app.activeSemester;
    }),
  );

  // Populate moduleBank moduleList using "succeeded" requests-middleware requests
  store.dispatch({ type: SUCCESS_KEY(FETCH_MODULE_LIST), payload: modulesList });

  return {
    store,
    ...renderWithRouterMatch(
      <Provider store={store}>
        <TimetableContainerComponent />
      </Provider>,
      {
        path: '/timetable/:semester?/:action?',
        location,
      },
      options.renderOptions,
    ),
  };
}

describe(TimetableContainerComponent, () => {
  let mockAxiosRequest: jest.SpiedFunction<typeof axios.request>;

  beforeEach(() => {
    mockDom();
    mockAxiosRequest = jest.spyOn(axios, 'request');
    mockAxiosRequest.mockResolvedValue(cs1010sResponse);
  });

  afterEach(() => {
    mockAxiosRequest.mockRestore();
    mockDomReset();
  });

  test("timetable", async () => {
    const semester = 1;
    const location = timetablePage(semester);
    make(location);
    const user = userEvent.setup()
    
    // Expect import header not to be present
    expect(screen.queryByRole('button', { name: 'Import' })).not.toBeInTheDocument();

    const previousSemesterButton = screen.getByTestId(/next-semester/);
    await user.click(previousSemesterButton);
    expect(screen.getByText(/Semester 2/)).toBeInTheDocument();

    expect(screen.queryByText(/CS1010S Programming Methodology/)).not.toBeInTheDocument();
    
    const addCourseInput = screen.getByPlaceholderText(/Add course to timetable/);
    user.click(addCourseInput);
    user.type(addCourseInput, "CS1010S");

    const addModuleButton = await screen.findByRole('option', { name: 'CS1010S Programming Methodology' });
    expect(addModuleButton).toBeInTheDocument();
    user.click(addModuleButton);

    // Expect imported module info to be displayed
    expect(await screen.findByText(/LEC/)).toBeInTheDocument();
    expect(screen.getByText(/TUT/)).toBeInTheDocument();
    expect(screen.getByText(/REC/)).toBeInTheDocument();

    // Expect correct network calls to be made
    expect(mockAxiosRequest).toHaveBeenCalledTimes(1);

    // Change tutorial lesson to TUT [1]
    const tutorialLesson = screen.getByText(/TUT/);
    user.click(tutorialLesson);

    user.click(await screen.findByText(/TUT \[1\]/));
    await waitForElementToBeRemoved(await screen.findByText(/TUT \[2\]/));
    expect(screen.getAllByText(/TUT/)).toHaveLength(1);

    // Make module TA Module
    user.click(screen.getByLabelText(/Enable TA for CS1010S/));
    expect(await screen.findAllByText(/CS1010S \(TA\)/)).toHaveLength(3);

    user.click(await screen.findByText(/TUT \[1\]/));
    user.click(await screen.findByText(/TUT \[2\]/));
    await waitForElementToBeRemoved(await screen.findByText(/TUT \[3\]/));
    expect(screen.getAllByText(/TUT/)).toHaveLength(2);

    user.click(await screen.findByText(/TUT \[1\]/));
    user.click(await screen.findByText(/TUT \[1\]/));
    await waitForElementToBeRemoved(await screen.findByText(/TUT \[1\]/));
    expect(screen.getAllByText(/TUT/)).toHaveLength(1);

    // Hide Module
    user.click(screen.getByLabelText(/Hide CS1010S/));
    await waitForElementToBeRemoved(screen.queryByText(/LEC/));
    expect(screen.queryByText(/TUT/)).not.toBeInTheDocument();
    expect(screen.queryByText(/REC/)).not.toBeInTheDocument();

    // Remove module
    user.click(screen.getByLabelText(/Remove CS1010S from timetable/));
    const moduleRemovedText = await screen.findByText(/CS1010S removed/);
    expect(moduleRemovedText).toBeInTheDocument();

    // Undo remove module
    user.click(screen.getByText(/Undo/));
    await waitForElementToBeRemoved(moduleRemovedText);
    expect(screen.getByText(/CS1010S Programming Methodology/)).toBeInTheDocument();

    // Reset timetable
    user.click(screen.getByText(/Reset/));
    const confirmationDialog = await screen.findByRole("dialog");
    const resetConfirmationButton = getByText(confirmationDialog, /Reset/);
    user.click(resetConfirmationButton);
    await waitForElementToBeRemoved(screen.queryByText(/CS1010S Programming Methodology/));
  });
});
