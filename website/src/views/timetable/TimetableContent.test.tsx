import { act, getByText, screen, waitForElementToBeRemoved } from '@testing-library/react';
import type { RenderOptions } from '@testing-library/react';
import { Provider } from 'react-redux';
import axios, { AxiosHeaders, AxiosResponse } from 'axios';
import { produce } from 'immer';

import { FETCH_MODULE, FETCH_MODULE_LIST } from 'actions/constants';
import configureStore from 'bootstrapping/configure-store';
import { SUCCESS_KEY } from 'middlewares/requests-middleware';
import reducers from 'reducers';
import { mockDom, mockDomReset } from 'test-utils/mockDom';
import { initAction } from 'test-utils/redux';
import renderWithRouterMatch from 'test-utils/renderWithRouterMatch';

import { timetablePage } from 'views/routes/paths';

import { CS1010S } from '__mocks__/modules';
import modulesList from '__mocks__/moduleList.json';

import { TimetableContainerComponent } from './TimetableContainer';
import userEvent from '@testing-library/user-event';
import { MockInstance } from 'vitest';
import { TimetableContent } from './TimetableContent';
import { Dispatch } from 'types/redux';
import { setTimetable } from 'actions/timetables';

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

describe(TimetableContent, () => {
  let mockAxiosRequest: MockInstance<typeof axios.request>;
  const semester = 1;

  describe('with blank timetable', async () => {
    beforeEach(() => {
      mockDom();
      mockAxiosRequest = vi.spyOn(axios, 'request');
      mockAxiosRequest.mockResolvedValue(cs1010sResponse);
    });

    afterEach(() => {
      mockAxiosRequest.mockRestore();
      mockDomReset();
    });

    test('add course to timetable', async () => {
      const location = timetablePage(semester);
      make(location);
      const user = userEvent.setup();

      const addCourseInput = screen.getByPlaceholderText(/Add course to timetable/);
      user.click(addCourseInput);
      user.type(addCourseInput, 'CS1010S');

      const addModuleButton = await screen.findByRole('option', {
        name: 'CS1010S Programming Methodology',
      });
      expect(addModuleButton).toBeInTheDocument();
      user.click(addModuleButton);

      expect(await screen.findByText(/LEC/)).toBeInTheDocument();
      expect(screen.getByText(/TUT/)).toBeInTheDocument();
      expect(screen.getByText(/REC/)).toBeInTheDocument();

      expect(mockAxiosRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('with non-blank timetable', async () => {
    beforeEach(async () => {
      mockDom();
      mockAxiosRequest = vi.spyOn(axios, 'request');
      const semester = 1;
      const location = timetablePage(semester);
      const { store } = make(location);

      // Populate moduleBank using "succeeded" requests-middleware requests
      await act(async () => {
        store.dispatch({ type: SUCCESS_KEY(FETCH_MODULE), payload: CS1010S });
      });

      // Populate mock timetable
      await act(async () => {
        const timetable = {
          CS1010S: {
            Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
            Recitation: ['1|THU|1200|1300|S14-0619|1_2_3_4_5_6_7_8_9_10_11_12_13'],
            Tutorial: ['1|MON|0900|1000|COM1-0203|3_4_5_6_7_8_9_10_11_12_13'],
          },
        };
        (store.dispatch as Dispatch)(setTimetable(semester, timetable));
      });
    });

    afterEach(() => {
      mockAxiosRequest.mockRestore();
      mockDomReset();
    });

    test('change tutorial lesson', async () => {
      const user = userEvent.setup();
      const tutorialLesson = screen.getByText(/TUT/);
      user.click(tutorialLesson);

      user.click(await screen.findByText(/TUT \[1\]/));
      await waitForElementToBeRemoved(await screen.findByText(/TUT \[2\]/));
      expect(screen.getAllByText(/TUT/)).toHaveLength(1);
    });

    test('make module TA', async () => {
      const user = userEvent.setup();
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
    });

    test('hide module', async () => {
      const user = userEvent.setup();
      user.click(screen.getByLabelText(/Hide CS1010S/));
      await waitForElementToBeRemoved(screen.queryByText(/LEC/));
      expect(screen.queryByText(/TUT/)).not.toBeInTheDocument();
      expect(screen.queryByText(/REC/)).not.toBeInTheDocument();
    });

    test('remove module and undo remove', async () => {
      const user = userEvent.setup();
      user.click(screen.getByLabelText(/Remove CS1010S from timetable/));
      const moduleRemovedText = await screen.findByText(/CS1010S removed/);

      expect(moduleRemovedText).toBeInTheDocument();
      user.click(screen.getByText(/Undo/));

      await waitForElementToBeRemoved(moduleRemovedText);
      expect(screen.getByText(/CS1010S Programming Methodology/)).toBeInTheDocument();
    });

    test('reset timetable', async () => {
      const user = userEvent.setup();
      user.click(screen.getByText(/Reset/));
      const confirmationDialog = await screen.findByRole('dialog');
      const resetConfirmationButton = getByText(confirmationDialog, /Reset/);
      user.click(resetConfirmationButton);
      await waitForElementToBeRemoved(screen.queryByText(/CS1010S Programming Methodology/));
    });
  });
});
