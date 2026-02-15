import { ExportData } from 'types/export';
import { VERTICAL } from 'types/reducers';
import reducers from 'reducers';
import { setExportedData } from 'actions/export';
import modules from '__mocks__/modules/index';
import { DARK_COLOR_SCHEME, DARK_COLOR_SCHEME_PREFERENCE } from 'types/settings';
import { TimetableConfig } from 'types/timetables';

/* eslint-disable no-useless-computed-key */

const exportData: ExportData = {
  semester: 1,
  timetable: {
    CS3216: {
      Lecture: ["1|MON|1830|2030|VCRm|(1,2,3,4,5,6,7,8,9,10,11,12,13)"],
    },
    CS1010S: {
      Lecture: ["1|WED|1000|1200|LT26|(1,2,3,4,5,6,7,8,9,10,11,12,13)"],
      Tutorial: ["1|MON|0900|1000|COM1-0203|(3,4,5,6,7,8,9,10,11,12,13)"],
      Recitation: ["1|THU|1200|1300|S14-0619|(1,2,3,4,5,6,7,8,9,10,11,12,13)"],
    },
    PC1222: {
      Lecture: ["SL1|TUE|1000|1200|LT31|(1,2,3,4,5,6,7,8,9,10,11,12,13)"],
      Tutorial: ["ST1|MON|1700|1800|S12-0401|(1,2,3,4,5,6,7,8,9,10,11,12,13)"],
    },
  },
  colors: {
    CS3216: 1,
    CS1010S: 0,
    PC1222: 2,
  },
  hidden: ['PC1222'],
  ta: ['CS1010S'],
  theme: {
    id: 'google',
    timetableOrientation: VERTICAL,
    showTitle: true,
  },
  settings: {
    colorScheme: DARK_COLOR_SCHEME,
  },
};

jest.mock(
  'storage/persistReducer',
  <T>() =>
    (_key: string, reducer: T) =>
      reducer,
);

test('reducers should set export data state', () => {
  const state = reducers({} as any, setExportedData(modules, exportData));

  expect(state.timetables).toEqual({
    lessons: {
      [1]: {
        CS3216: {
          Lecture: ["1|MON|1830|2030|VCRm|(1,2,3,4,5,6,7,8,9,10,11,12,13)"],
        },
        CS1010S: {
          Lecture: ["1|WED|1000|1200|LT26|(1,2,3,4,5,6,7,8,9,10,11,12,13)"],
          Tutorial: ["1|MON|0900|1000|COM1-0203|(3,4,5,6,7,8,9,10,11,12,13)"],
          Recitation: ["1|THU|1200|1300|S14-0619|(1,2,3,4,5,6,7,8,9,10,11,12,13)"],
        },
        PC1222: {
          Lecture: ["SL1|TUE|1000|1200|LT31|(1,2,3,4,5,6,7,8,9,10,11,12,13)"],
          Tutorial: ["ST1|MON|1700|1800|S12-0401|(1,2,3,4,5,6,7,8,9,10,11,12,13)"],
        },
      },
    } as TimetableConfig,
    colors: {
      [1]: {
        CS3216: 1,
        CS1010S: 0,
        PC1222: 2,
      },
    },
    hidden: { [1]: ['PC1222'] },
    ta: { [1]: ['CS1010S'] },
    academicYear: expect.any(String),
    archive: {},
  });

  expect(state.settings).toMatchObject({
    colorScheme: DARK_COLOR_SCHEME_PREFERENCE,
  });

  expect(state.theme).toEqual({
    id: 'google',
    timetableOrientation: VERTICAL,
    showTitle: true,
  });
});
