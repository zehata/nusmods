import NUSModerator from 'nusmoderator';
import { filter, flatMap, get, map, mapValues, shuffle, some, values } from 'lodash-es';
import { parseISO } from 'date-fns';
import {
  ColoredLesson,
  ModuleLessonConfig,
  SemTimetableConfig,
  SemTimetableConfigWithLessons,
  TimetableArrangement,
  TimetableDayArrangement,
  TimetableDayFormat,
  Lesson,
} from 'types/timetables';
import { LessonKey, LessonType, ModuleCode, RawLesson, Semester, Weeks } from 'types/modules';
import { ModulesMap } from 'types/reducers';

import { getModuleLessonMap, getModuleSemesterData, getModuleTimetable } from 'utils/modules';

import { CS1010S, CS3216, CS4243, PC1222, CS1010A, GER1000, GES1021 } from '__mocks__/modules';
import moduleCodeMapJSON from '__mocks__/module-code-map.json';
import timetable from '__mocks__/sem-timetable.json';
import lessonsArray from '__mocks__/lessons-array.json';

import {
  createGenericColoredLesson,
  createGenericLesson,
  EVEN_WEEK,
  EVERY_WEEK,
  ODD_WEEK,
} from 'test-utils/timetable';

import {
  areOtherClassesAvailable,
  arrangeLessonsForWeek,
  arrangeLessonsWithinDay,
  deserializeTimetable,
  doLessonsOverlap,
  findExamClashes,
  formatNumericWeeks,
  getClosestLessonConfig,
  getEndTimeAsDate,
  getInteractableLessons,
  getRecoveryLessonKeys,
  getStartTimeAsDate,
  groupLessonsByDay,
  hydrateSemTimetableWithLessons,
  isLessonAvailable,
  isLessonOngoing,
  isValidSemester,
  lessonsForLessonType,
  migrateModuleLessonConfig,
  parseTaModuleCodes,
  randomModuleLessonConfig,
  serializeLessonDetails,
  serializeTimetable,
  timetableLessonsArray,
  validateTimetableModules,
} from './timetables';

// TODO: Fix this later
const moduleCodeMap = moduleCodeMapJSON as any;

describe(isValidSemester, () => {
  test('semesters 1-4 are valid', () => {
    expect(isValidSemester(1)).toBe(true);
    expect(isValidSemester(2)).toBe(true);
    expect(isValidSemester(3)).toBe(true);
    expect(isValidSemester(4)).toBe(true);
  });

  test('non 1-4 are invalid', () => {
    expect(isValidSemester(0)).toBe(false);
    expect(isValidSemester(5)).toBe(false);
  });
});

test('randomModuleLessonConfig should return a random lesson config', () => {
  const sem: Semester = 1;
  const rawLessons = getModuleTimetable(CS1010S, sem);
  const lessonConfig: ModuleLessonConfig = randomModuleLessonConfig(rawLessons);
  Object.keys(lessonConfig).forEach((lessonType: LessonType) => {
    expect(lessonConfig[lessonType]).toBeTruthy();
  });
});

test('hydrateSemTimetableWithLessons should replace ClassNo with lessons', () => {
  const sem: Semester = 1;
  const moduleCode = 'CS1010S';
  const modulesMap: ModulesMap = { [moduleCode]: CS1010S };
  const config: SemTimetableConfig = {
    [moduleCode]: {
      Tutorial: [
        '8|MON|1600|1700|AS6-0208|3_4_5_6_7_8_9_10_11_12_13',
        '9|MON|1700|1800|AS6-0208|3_4_5_6_7_8_9_10_11_12_13',
      ],
      Recitation: ['4|THU|1700|1800|S14-0619|1_2_3_4_5_6_7_8_9_10_11_12_13'],
      Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
    },
  };

  const configWithLessons: SemTimetableConfigWithLessons<Lesson> = hydrateSemTimetableWithLessons(
    config,
    modulesMap,
    sem,
  );
  expect(new Set(map(configWithLessons[moduleCode].Tutorial, 'classNo'))).toEqual(
    new Set(['8', '9']),
  );
  expect(new Set(map(configWithLessons[moduleCode].Recitation, 'classNo'))).toEqual(new Set(['4']));
  expect(new Set(map(configWithLessons[moduleCode].Lecture, 'classNo'))).toEqual(new Set(['1']));
});

test('lessonsForLessonType should return all lessons belonging to a particular lessonType', () => {
  const sem: Semester = 1;
  const moduleTimetable = getModuleTimetable(CS1010S, sem);
  const lessonType = 'Tutorial';
  const lessons = lessonsForLessonType(moduleTimetable, lessonType);
  expect(lessons.length > 0).toBe(true);
  lessons.forEach((lesson: RawLesson) => {
    expect(lesson.lessonType).toBe(lessonType);
  });
});

test('lessonsForLessonType should return empty array if no such lessonType is present', () => {
  const sem: Semester = 1;
  const moduleTimetable = getModuleTimetable(CS1010S, sem);
  const lessons = lessonsForLessonType(moduleTimetable, 'Dota Session');
  expect(lessons.length).toBe(0);
  expect(lessons).toEqual([]);
});

test('timetableLessonsArray should return a flat array of lessons', () => {
  const someTimetable = timetable;
  expect(timetableLessonsArray(someTimetable).length).toBe(6);
});

test('groupLessonsByDay should group lessons by DayText', () => {
  const lessons: ColoredLesson[] = lessonsArray;
  const lessonsGroupedByDay: TimetableDayFormat<ColoredLesson> = groupLessonsByDay(lessons);
  expect(lessonsGroupedByDay.Monday.length).toBe(2);
  expect(lessonsGroupedByDay.Tuesday.length).toBe(1);
  expect(lessonsGroupedByDay.Wednesday.length).toBe(1);
  expect(lessonsGroupedByDay.Thursday.length).toBe(2);
});

// TODO: write one for array lesson overlap
test('doLessonsOverlap should correctly determine if two lessons overlap', () => {
  // Same day same time.
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '1000', '1200'),
      createGenericLesson('Wednesday', '1000', '1200'),
    ),
  ).toBe(true);
  // Same day with no overlapping time.
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '1000', '1200'),
      createGenericLesson('Wednesday', '1200', '1400'),
    ),
  ).toBe(false);
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '1200', '1400'),
      createGenericLesson('Wednesday', '1000', '1200'),
    ),
  ).toBe(false);
  // Same day with overlapping time.
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '1000', '1200'),
      createGenericLesson('Wednesday', '1100', '1300'),
    ),
  ).toBe(true);
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '1100', '1300'),
      createGenericLesson('Wednesday', '1000', '1200'),
    ),
  ).toBe(true);
  // Same day with one lesson totally within another lesson.
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '1000', '1200'),
      createGenericLesson('Wednesday', '0900', '1300'),
    ),
  ).toBe(true);
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '0900', '1300'),
      createGenericLesson('Wednesday', '1000', '1200'),
    ),
  ).toBe(true);
  // Different day same time.
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '1000', '1200'),
      createGenericLesson('Thursday', '1000', '1200'),
    ),
  ).toBe(false);
  // Different day with no overlapping time.
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '1000', '1200'),
      createGenericLesson('Thursday', '1200', '1400'),
    ),
  ).toBe(false);
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '1200', '1400'),
      createGenericLesson('Thursday', '1000', '1200'),
    ),
  ).toBe(false);
  // Different day with overlapping time.
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '1000', '1200'),
      createGenericLesson('Thursday', '1100', '1300'),
    ),
  ).toBe(false);
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '1100', '1300'),
      createGenericLesson('Thursday', '1000', '1200'),
    ),
  ).toBe(false);
  // Different day with one lesson totally within another lesson.
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '1000', '1200'),
      createGenericLesson('Thursday', '0900', '1300'),
    ),
  ).toBe(false);
  expect(
    doLessonsOverlap(
      createGenericLesson('Wednesday', '0900', '1300'),
      createGenericLesson('Thursday', '1000', '1200'),
    ),
  ).toBe(false);
});

test('arrangeLessonsWithinDay', () => {
  // Empty array.
  const arrangement0: TimetableDayArrangement<RawLesson> = arrangeLessonsWithinDay([]);
  expect(arrangement0.length).toBe(1);

  // Can fit within one row.
  const arrangement1: TimetableDayArrangement<ColoredLesson> = arrangeLessonsWithinDay(
    shuffle([
      createGenericColoredLesson('Monday', '1000', '1200'),
      createGenericColoredLesson('Monday', '1600', '1800'),
      createGenericColoredLesson('Monday', '1400', '1500'),
    ]),
  );
  expect(arrangement1.length).toBe(1);

  // Two rows.
  const arrangement2: TimetableDayArrangement<ColoredLesson> = arrangeLessonsWithinDay(
    shuffle([
      createGenericColoredLesson('Monday', '1000', '1200'),
      createGenericColoredLesson('Monday', '1600', '1800'),
      createGenericColoredLesson('Monday', '1500', '1700'),
    ]),
  );
  expect(arrangement2.length).toBe(2);

  // Three rows.
  const arrangement3: TimetableDayArrangement<ColoredLesson> = arrangeLessonsWithinDay(
    shuffle([
      createGenericColoredLesson('Monday', '1000', '1200'),
      createGenericColoredLesson('Monday', '1100', '1300'),
      createGenericColoredLesson('Monday', '1000', '1300'),
    ]),
  );
  expect(arrangement3.length).toBe(3);
});

test('arrangeLessonsForWeek', () => {
  const arrangement0: TimetableArrangement<ColoredLesson> = arrangeLessonsForWeek(
    shuffle([
      createGenericColoredLesson('Monday', '1000', '1200'),
      createGenericColoredLesson('Monday', '1600', '1800'),
      createGenericColoredLesson('Monday', '1400', '1500'),
    ]),
  );
  expect(arrangement0.Monday.length).toBe(1);

  const arrangement1: TimetableArrangement<ColoredLesson> = arrangeLessonsForWeek(
    shuffle([
      createGenericColoredLesson('Monday', '1000', '1200'),
      createGenericColoredLesson('Monday', '1600', '1800'),
      createGenericColoredLesson('Monday', '1400', '1500'),
      createGenericColoredLesson('Tuesday', '1400', '1500'),
      createGenericColoredLesson('Tuesday', '1400', '1500'),
    ]),
  );
  expect(arrangement1.Monday.length).toBe(1);
  expect(arrangement1.Tuesday.length).toBe(2);

  const arrangement2: TimetableArrangement<ColoredLesson> = arrangeLessonsForWeek(
    shuffle([
      createGenericColoredLesson('Monday', '1000', '1200'),
      createGenericColoredLesson('Monday', '1600', '1800'),
      createGenericColoredLesson('Monday', '1400', '1500'),
      createGenericColoredLesson('Tuesday', '1400', '1500'),
      createGenericColoredLesson('Tuesday', '1600', '1800'),
    ]),
  );
  expect(arrangement2.Monday.length).toBe(1);
  expect(arrangement2.Tuesday.length).toBe(1);

  const arrangement3: TimetableArrangement<ColoredLesson> = arrangeLessonsForWeek(
    shuffle([
      createGenericColoredLesson('Monday', '1000', '1200'),
      createGenericColoredLesson('Tuesday', '1100', '1300'),
      createGenericColoredLesson('Wednesday', '1000', '1300'),
    ]),
  );
  expect(arrangement3.Monday.length).toBe(1);
  expect(arrangement3.Tuesday.length).toBe(1);
  expect(arrangement3.Wednesday.length).toBe(1);

  const arrangement4: TimetableArrangement<ColoredLesson> = arrangeLessonsForWeek(
    shuffle([
      createGenericColoredLesson('Monday', '1000', '1200'),
      createGenericColoredLesson('Monday', '1600', '1800'),
      createGenericColoredLesson('Tuesday', '1100', '1300'),
      createGenericColoredLesson('Wednesday', '1000', '1300'),
    ]),
  );
  expect(arrangement4.Monday.length).toBe(1);
  expect(arrangement4.Tuesday.length).toBe(1);
  expect(arrangement4.Wednesday.length).toBe(1);

  const arrangement5: TimetableArrangement<ColoredLesson> = arrangeLessonsForWeek(
    shuffle([
      createGenericColoredLesson('Monday', '1000', '1200'),
      createGenericColoredLesson('Monday', '1600', '1800'),
      createGenericColoredLesson('Tuesday', '1100', '1300'),
      createGenericColoredLesson('Tuesday', '1200', '1400'),
      createGenericColoredLesson('Wednesday', '1000', '1300'),
      createGenericColoredLesson('Wednesday', '1100', '1400'),
    ]),
  );
  expect(arrangement5.Monday.length).toBe(1);
  expect(arrangement5.Tuesday.length).toBe(2);
  expect(arrangement5.Wednesday.length).toBe(2);
});

test('areOtherClassesAvailable', () => {
  // Lessons belong to different ClassNo.
  const lessons1: RawLesson[] = shuffle([
    createGenericLesson('Monday', '1000', '1200', 'Lecture', '1'),
    createGenericLesson('Monday', '1600', '1800', 'Lecture', '2'),
    createGenericLesson('Monday', '1400', '1500', 'Lecture', '3'),
  ]);
  expect(areOtherClassesAvailable(lessons1, 'Lecture')).toBe(true);
  expect(areOtherClassesAvailable(lessons1, 'Tutorial')).toBe(false);

  // Lessons belong to the same ClassNo.
  const lessons2: RawLesson[] = shuffle([
    createGenericLesson('Monday', '1000', '1200', 'Lecture', '1'),
    createGenericLesson('Monday', '1600', '1800', 'Lecture', '1'),
    createGenericLesson('Monday', '1400', '1500', 'Lecture', '1'),
  ]);
  expect(areOtherClassesAvailable(lessons2, 'Lecture')).toBe(false);

  // Lessons belong to different lessonType.
  const lessons3: RawLesson[] = shuffle([
    createGenericLesson('Monday', '1000', '1200', 'Lecture', '1'),
    createGenericLesson('Monday', '1600', '1800', 'Lecture', '1'),
    createGenericLesson('Monday', '1400', '1500', 'Tutorial', '1'),
    createGenericLesson('Monday', '1400', '1500', 'Tutorial', '2'),
  ]);
  expect(areOtherClassesAvailable(lessons3, 'Lecture')).toBe(false);
  expect(areOtherClassesAvailable(lessons3, 'Tutorial')).toBe(true);
});

describe('getInteractableLessons', () => {
  const modules = {
    [PC1222.moduleCode]: PC1222,
    [CS4243.moduleCode]: CS4243,
    [GES1021.moduleCode]: GES1021,
  };
  const semester = 1;
  const colors = {
    PC1222: 0,
    CS4243: 1,
    GES1021: 2,
  };

  const lessonsMap: Record<ModuleCode, Record<LessonType, Record<LessonKey, Lesson>>> = mapValues(
    modules,
    (module) => ({
      ...mapValues(getModuleLessonMap(module, semester), (lessonsWithLessonType) => ({
        ...mapValues(lessonsWithLessonType, (lesson) => ({
          ...lesson,
          moduleCode: module.moduleCode,
          title: module.title,
        })),
      })),
    }),
  );

  describe('hydrating modules when there is no active lesson', () => {
    const lessonWithAlternative = '1|TUE|1400|1600|AS6-0421|3_4_5_6_7_8_9_10_11_12_13';
    const lessonWithNoAlternative = '1|MON|1830|2030|LT15|1_2_3_4_5_6_7_8_9_10_11_12_13';

    const semTimetableConfig: SemTimetableConfig = {
      [PC1222.moduleCode]: {
        Laboratory: [
          'F01|FRI|1400|1700|S12-0402|3_5_7_9_11',
          'F02|FRI|1400|1700|S12-0402|4_6_8_10_12',
        ],
        Lecture: ['SL1|TUE|1200|1400|LT25|1_2_3_4_5_6_7_8_9_10_11_12_13'],
        Tutorial: [
          'SL1|FRI|1200|1400|LT25|1_2_3_4_5_6_7_8_9_10_11_12_13',
          'T1|MON|1600|1700|S11-0204|1_2_3_4_5_6_7_8_9_10_11_12_13',
          'T10|FRI|1700|1800|S11-0204|1_2_3_4_5_6_7_8_9_10_11_12_13',
        ],
      },
      [CS4243.moduleCode]: {
        Laboratory: [lessonWithAlternative],
        Lecture: [lessonWithNoAlternative],
      },
    };

    const timetableLessons = hydrateSemTimetableWithLessons(semTimetableConfig, modules, semester);

    const readOnly = false;
    const activeLesson = null;

    const hydratedLessons = getInteractableLessons(
      timetableLessons,
      [PC1222.moduleCode],
      modules,
      semester,
      colors,
      readOnly,
      activeLesson,
    );

    const allLessons = flatMap(hydratedLessons, (modulesLessons) =>
      flatMap(modulesLessons, (lessonTypeLessons) => values(lessonTypeLessons)),
    );

    test('all lessons are marked as non active because there is no active lesson', () => {
      expect(some(allLessons, (lesson) => lesson.isActive)).toBe(false);
    });

    test('when there are no active lessons, only lessons that are in timetable are present, they cannot be added to lesson config', () => {
      expect(some(allLessons, (lesson) => lesson.canBeAddedToLessonConfig)).toBe(false);
    });

    test('lessons from ta module are marked as ta in timetable', () => {
      const lessonsFromTaModule = flatMap(hydratedLessons[PC1222.moduleCode], (lessons) =>
        values(lessons),
      );
      expect(some(lessonsFromTaModule, (lesson) => !lesson.isTaInTimetable)).toBe(false);
    });

    test('lessons from non-ta module are marked as not ta in timetable', () => {
      const lessonsFromNonTaModule = flatMap(hydratedLessons[CS4243.moduleCode], (lessons) =>
        values(lessons),
      );
      expect(some(lessonsFromNonTaModule, (lesson) => lesson.isTaInTimetable)).toBe(false);
    });

    test('hydration of lessons with alternative lessons', () => {
      expect(
        get(hydratedLessons, [CS4243.moduleCode, 'Laboratory', lessonWithAlternative])
          ?.canBeSelectedAsActiveLesson,
      ).toBe(true);
    });

    test('hydration of lessons with no alternative lessons', () => {
      expect(
        get(hydratedLessons, [CS4243.moduleCode, 'Lecture', lessonWithNoAlternative])
          ?.canBeSelectedAsActiveLesson,
      ).toBe(false);
    });

    test('should only show lessons in timetable when no lesson is active', () => {
      expect(allLessons).toHaveLength(
        flatMap(timetableLessons, (moduleLessons) =>
          flatMap(moduleLessons, (lessons) => values(lessons)),
        ).length,
      );
    });
  });

  describe('hydrating modules when there is an active lesson from a non-ta module', () => {
    const activeLessonKey = 'F01|FRI|1400|1700|S12-0402|3_5_7_9_11';

    const semTimetableConfig: SemTimetableConfig = {
      [PC1222.moduleCode]: {
        Laboratory: [activeLessonKey],
        Lecture: ['SL1|TUE|1200|1400|LT25|1_2_3_4_5_6_7_8_9_10_11_12_13'],
        Tutorial: ['T1|MON|1600|1700|S11-0204|1_2_3_4_5_6_7_8_9_10_11_12_13'],
      },
    };

    const timetableLessons = hydrateSemTimetableWithLessons(semTimetableConfig, modules, semester);

    const readOnly = false;
    const activeLesson = get(timetableLessons, [PC1222.moduleCode, 'Laboratory', activeLessonKey]);

    const hydratedLessons = getInteractableLessons(
      timetableLessons,
      [],
      modules,
      semester,
      colors,
      readOnly,
      activeLesson,
    );

    const hydratedActiveLesson = get(hydratedLessons, [
      PC1222.moduleCode,
      'Laboratory',
      activeLessonKey,
    ]);

    test('active lesson should be marked as active', () => {
      expect(hydratedActiveLesson?.isActive).toBe(true);
    });

    test('active lesson is already in lesson config', () => {
      expect(hydratedActiveLesson?.canBeAddedToLessonConfig).toBe(false);
    });

    const hydratedAlternativeLessons = filter(
      flatMap(get(hydratedLessons, PC1222.moduleCode), (lessons) => values(lessons)),
      (lesson) =>
        lesson.lessonType === activeLesson.lessonType && lesson.classNo !== activeLesson.classNo,
    );

    test('alternative lessons can be added to the lesson config', () => {
      expect(some(hydratedAlternativeLessons, (lesson) => !lesson.canBeAddedToLessonConfig)).toBe(
        false,
      );
    });

    test('all alternative lessons are displayed', () => {
      const alternativeLessons = filter(
        flatMap(get(lessonsMap, PC1222.moduleCode), (lessons) => values(lessons)),
        (lesson) =>
          lesson.lessonType === activeLesson.lessonType && lesson.classNo !== activeLesson.classNo,
      );

      const indicesOfAlternativeLessons = new Set(map(alternativeLessons, serializeLessonDetails));
      const indicesOfHydratedAlternativeLessons = new Set(
        map(hydratedAlternativeLessons, serializeLessonDetails),
      );

      expect(indicesOfAlternativeLessons).toEqual(indicesOfHydratedAlternativeLessons);
    });
  });

  describe('hydrating modules when there is an active lesson from a ta module', () => {
    const activeLessonKey = '1|TUE|1400|1600|AS6-0421|3_4_5_6_7_8_9_10_11_12_13';

    const timetableLessonsKeys = [
      activeLessonKey,
      '2|TUE|1600|1800|AS6-0421|3_4_5_6_7_8_9_10_11_12_13',
      '3|TUE|1830|2030|AS6-0421|3_4_5_6_7_8_9_10_11_12_13',
    ];

    const semTimetableConfig: SemTimetableConfig = {
      [PC1222.moduleCode]: {
        Laboratory: ['F01|FRI|1400|1700|S12-0402|3_5_7_9_11'],
        Lecture: ['SL1|TUE|1200|1400|LT25|1_2_3_4_5_6_7_8_9_10_11_12_13'],
        Tutorial: ['T1|MON|1600|1700|S11-0204|1_2_3_4_5_6_7_8_9_10_11_12_13'],
      },
      [CS4243.moduleCode]: {
        Laboratory: timetableLessonsKeys,
        Lecture: ['1|MON|1830|2030|LT15|1_2_3_4_5_6_7_8_9_10_11_12_13'],
      },
    };

    const timetableLessons = hydrateSemTimetableWithLessons(semTimetableConfig, modules, semester);

    const readOnly = false;
    const activeLesson = get(timetableLessons, [CS4243.moduleCode, 'Laboratory', activeLessonKey]);

    const hydratedLessons = getInteractableLessons(
      timetableLessons,
      [CS4243.moduleCode],
      modules,
      semester,
      colors,
      readOnly,
      activeLesson,
    );

    const hydratedOtherModuleLessons = filter(
      flatMap(get(hydratedLessons, PC1222.moduleCode), (lessons) => values(lessons)),
      (lesson) =>
        lesson.lessonType === activeLesson.lessonType && lesson.classNo !== activeLesson.classNo,
    );

    test('lessons that are not from the same module as the active lesson cannot be added', () => {
      expect(some(hydratedOtherModuleLessons, (lesson) => lesson.canBeAddedToLessonConfig)).toBe(
        false,
      );
    });

    test('timetable lessons from other modules are visible', () => {
      const otherModuleLessons = filter(
        flatMap(get(lessonsMap, PC1222.moduleCode), (lessons) => values(lessons)),
        (lesson) =>
          lesson.lessonType === activeLesson.lessonType && lesson.classNo !== activeLesson.classNo,
      );
      const indicesOfOtherModuleLessons = new Set(map(otherModuleLessons, 'lessonIndex'));
      const indicesOfHydratedOtherModuleLessons = new Set(
        map(hydratedOtherModuleLessons, 'lessonIndex'),
      );

      expect(indicesOfHydratedOtherModuleLessons).toEqual(indicesOfOtherModuleLessons);
    });

    const hydratedActiveLesson = get(hydratedLessons, [
      CS4243.moduleCode,
      'Laboratory',
      activeLessonKey,
    ]);

    test('active lesson should be marked as active', () => {
      expect(hydratedActiveLesson?.isActive).toBe(true);
    });

    test('active lesson is already in lesson config', () => {
      expect(hydratedActiveLesson?.canBeAddedToLessonConfig).toBe(false);
    });

    const hydratedActiveModuleLessons = flatMap(
      get(hydratedLessons, CS4243.moduleCode),
      (lessons) => values(lessons),
    );

    test('all lessons of a ta module are interactable', () => {
      expect(
        some(hydratedActiveModuleLessons, (lesson) => !lesson.canBeSelectedAsActiveLesson),
      ).toBe(false);
    });

    test("all lessons from the active lesson's module should be visible, currently selected lessons and active lesson should not appear twice", () => {
      expect(hydratedActiveModuleLessons).toHaveLength(6);
    });

    const hydratedAlternativeLessons = filter(
      hydratedActiveModuleLessons,
      (lesson) =>
        lesson.lessonType === activeLesson.lessonType && lesson.classNo !== activeLesson.classNo,
    );

    test('alternative lessons in timetable are already added to the lesson config', () => {
      const alternativeTimetableLessonsArray = filter(hydratedAlternativeLessons, (lesson) =>
        timetableLessonsKeys.includes(serializeLessonDetails(lesson)),
      );

      expect(
        some(alternativeTimetableLessonsArray, (lesson) => lesson.canBeAddedToLessonConfig),
      ).toBe(false);
    });

    test('alternative lessons not in timetable can be added to the lesson config', () => {
      const alternativeNonTimetableLessonsArray = filter(
        hydratedAlternativeLessons,
        (lesson) => !timetableLessonsKeys.includes(serializeLessonDetails(lesson)),
      );

      expect(
        some(alternativeNonTimetableLessonsArray, (lesson) => !lesson.canBeAddedToLessonConfig),
      ).toBe(false);
    });

    test('all alternative lessons are displayed', () => {
      const alternativeLessons = filter(
        flatMap(get(lessonsMap, CS4243.moduleCode), (lessons) => values(lessons)),
        (lesson) =>
          lesson.lessonType === activeLesson.lessonType && lesson.classNo !== activeLesson.classNo,
      );
      const indicesOfAlternativeLessons = new Set(map(alternativeLessons, serializeLessonDetails));
      const indicesOfHydratedAlternativeLessons = new Set(
        map(hydratedAlternativeLessons, serializeLessonDetails),
      );

      expect(indicesOfAlternativeLessons).toEqual(indicesOfHydratedAlternativeLessons);
    });
  });

  describe('hydrating non-ta module containing multiple lessons with the same classNo', () => {
    const timetableLessonsKeys = [
      'SL1|MON|1600|1800|LT27|1_2_3_4_5_6_7_8_9_10_11_12_13',
      'SL1|WED|1600|1800|LT27|1_2_3_4_5_6_7_8_9_10_11_12_13',
    ];

    const semTimetableConfig: SemTimetableConfig = {
      [GES1021.moduleCode]: {
        Lecture: timetableLessonsKeys,
      },
    };

    const timetableLessons = hydrateSemTimetableWithLessons(semTimetableConfig, modules, semester);

    const readOnly = false;
    const activeLesson = null;

    const hydratedLessons = getInteractableLessons(
      timetableLessons,
      [],
      modules,
      semester,
      colors,
      readOnly,
      activeLesson,
    );

    const hydratedTimetableLessons = flatMap(get(hydratedLessons, [GES1021.moduleCode, 'Lecture']));

    test('lessons in timetable are already added to lesson config', () => {
      expect(some(hydratedTimetableLessons, (lesson) => lesson.canBeAddedToLessonConfig)).toBe(
        false,
      );
    });

    test('should only show lessons in timetable when no lesson is active', () => {
      expect(hydratedTimetableLessons).toHaveLength(timetableLessonsArray(timetableLessons).length);
    });
  });

  describe('hydrating ta module containing multiple lessons with the same classNo', () => {
    const timetableLessonKeys = ['SL1|MON|1600|1800|LT27|1_2_3_4_5_6_7_8_9_10_11_12_13'];

    const semTimetableConfig: SemTimetableConfig = {
      [GES1021.moduleCode]: {
        Lecture: timetableLessonKeys,
      },
    };

    const timetableLessons = hydrateSemTimetableWithLessons(semTimetableConfig, modules, semester);

    const readOnly = false;

    describe('when no lessons are active', () => {
      const activeLesson = null;

      const hydratedLessons = getInteractableLessons(
        timetableLessons,
        [GES1021.moduleCode],
        modules,
        semester,
        colors,
        readOnly,
        activeLesson,
      );

      const hydratedLessonsArray = timetableLessonsArray(hydratedLessons);

      test('only the lesson in the timetable are visible', () => {
        expect(hydratedLessonsArray).toHaveLength(timetableLessonsArray(timetableLessons).length);
      });

      test('lesson is already in timetable', () => {
        expect(some(hydratedLessonsArray, (lesson) => lesson.canBeAddedToLessonConfig)).toBe(false);
      });
    });

    describe('when a lesson is active', () => {
      const activeLesson = get(timetableLessons, [
        GES1021.moduleCode,
        'Lecture',
        'SL1|MON|1600|1800|LT27|1_2_3_4_5_6_7_8_9_10_11_12_13',
      ]);

      const hydratedLessons = getInteractableLessons(
        timetableLessons,
        [GES1021.moduleCode],
        modules,
        semester,
        colors,
        readOnly,
        activeLesson,
      );

      const hydratedLessonsArray = timetableLessonsArray(hydratedLessons);

      test('all lessons from the module are visible', () => {
        expect(hydratedLessonsArray).toHaveLength(2);
      });

      test('lesson already in timetable are already in the lesson config', () => {
        const hydratedTimetableLessons = filter(hydratedLessonsArray, (lesson) =>
          timetableLessonKeys.includes(serializeLessonDetails(lesson)),
        );

        expect(some(hydratedTimetableLessons, (lesson) => lesson.canBeAddedToLessonConfig)).toBe(
          false,
        );
      });

      test('lesson not in timetable can be added to the lesson config', () => {
        const hydratedNonTimetableLessonsArray = filter(
          hydratedLessonsArray,
          (lesson) => !timetableLessonKeys.includes(serializeLessonDetails(lesson)),
        );

        expect(
          some(hydratedNonTimetableLessonsArray, (lesson) => !lesson.canBeAddedToLessonConfig),
        ).toBe(false);
      });
    });
  });

  describe('hydrating modules in a readonly timetable', () => {
    const semTimetableConfig: SemTimetableConfig = {
      [PC1222.moduleCode]: {
        Laboratory: ['F01|FRI|1400|1700|S12-0402|3_5_7_9_11'],
        Lecture: ['SL1|TUE|1200|1400|LT25|1_2_3_4_5_6_7_8_9_10_11_12_13'],
        Tutorial: ['T1|MON|1600|1700|S11-0204|1_2_3_4_5_6_7_8_9_10_11_12_13'],
      },
      [CS4243.moduleCode]: {
        Laboratory: ['1|TUE|1400|1600|AS6-0421|3_4_5_6_7_8_9_10_11_12_13'],
        Lecture: ['1|MON|1830|2030|LT15|1_2_3_4_5_6_7_8_9_10_11_12_13'],
      },
    };

    const timetableLessons = hydrateSemTimetableWithLessons(semTimetableConfig, modules, semester);

    const readOnly = true;
    const activeLesson = null; // lessons cannot be selected as active in a readonly timetable

    const hydratedLessons = getInteractableLessons(
      timetableLessons,
      [PC1222.moduleCode],
      modules,
      semester,
      colors,
      readOnly,
      activeLesson,
    );

    const hydratedLessonsArray = timetableLessonsArray(hydratedLessons);

    test('lessons in readonly timetable cannot be select as active lesson', () => {
      expect(some(hydratedLessonsArray, (lesson) => lesson.canBeSelectedAsActiveLesson)).toBe(
        false,
      );
    });

    test('lessons from ta modules are marked as ta in timetable', () => {
      const hydratedTaModuleLessonsArray = flatMap(
        get(hydratedLessons, PC1222.moduleCode),
        (lessons) => values(lessons),
      );

      expect(some(hydratedTaModuleLessonsArray, (lesson) => !lesson.isTaInTimetable)).toBe(false);
    });

    test('lessons from non-ta modules are marked as not ta in timetable', () => {
      const hydratedNonTaModuleLessonsArray = flatMap(
        get(hydratedLessons, CS4243.moduleCode),
        (lessons) => values(lessons),
      );

      expect(some(hydratedNonTaModuleLessonsArray, (lesson) => lesson.isTaInTimetable)).toBe(false);
    });

    test('readonly timetables should only show the lessons in the timetable', () => {
      expect(hydratedLessonsArray).toHaveLength(5);
    });
  });
});

test('findExamClashes should return non-empty object if exams clash', () => {
  const sem: Semester = 1;
  const examClashes = findExamClashes([CS1010S, CS4243 as any, CS3216], sem);
  const examDate = get(getModuleSemesterData(CS1010S, sem), 'examDate');
  if (!examDate) throw new Error('Cannot find ExamDate');
  expect(examClashes).toEqual({ [examDate]: [CS1010S, CS4243] });
});

test('findExamClashes should return empty object if exams do not clash', () => {
  const sem: Semester = 2;
  const examClashes = findExamClashes([CS1010S, PC1222, CS3216], sem);
  expect(examClashes).toEqual({});
});

test('findExamClashes should return non-empty object if exams starting at different times clash', () => {
  const sem: Semester = 1;
  const examClashes = findExamClashes([CS1010S, CS3216 as any, CS1010A], sem);
  const examDate = get(getModuleSemesterData(CS1010A, sem), 'examDate');
  if (!examDate) throw new Error('Cannot find ExamDate');
  expect(examClashes).toEqual({ [examDate]: [CS1010S, CS1010A] });
});

describe('timetable serialization/deserialization', () => {
  const modules = {
    CS1010S,
    CS3216,
    GER1000,
    CS4243,
  } as ModulesMap;
  const semester: Semester = 1;

  describe('v3 timetable serialization/deserialization', () => {
    test('timetable serialization/deserialization', () => {
      const configs: SemTimetableConfig[] = [
        {},
        { CS1010S: {} },
        {
          GER1000: { Tutorial: ['B01|MON|0800|1000|BIZ2-0118|3_5_7_9_11'] },
        },
        {
          CS4243: {
            Laboratory: ['3|TUE|1830|2030|AS6-0421|3_4_5_6_7_8_9_10_11_12_13'],
            Lecture: ['1|MON|1830|2030|LT15|1_2_3_4_5_6_7_8_9_10_11_12_13'],
          },
          GER1000: { Tutorial: ['B01|MON|0800|1000|BIZ2-0118|3_5_7_9_11'] },
        },
      ];

      configs.forEach((config) => {
        expect(
          deserializeTimetable(serializeTimetable(config), modules, semester).semTimetableConfig,
        ).toEqual(config);
      });
    });

    test('deserializing timetable with ta and hidden modules', () => {
      expect(
        deserializeTimetable(
          'CS1010S=LEC:(1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13)&CS3216=LEC:(1|MON|1830|2030|VCRm|1_2_3_4_5_6_7_8_9_10_11_12_13)&ta=CS1010S&hidden=CS3216',
          modules,
          semester,
        ),
      ).toEqual({
        semTimetableConfig: {
          CS1010S: {
            Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
          },
          CS3216: {
            Lecture: ['1|MON|1830|2030|VCRm|1_2_3_4_5_6_7_8_9_10_11_12_13'],
          },
        },
        ta: ['CS1010S'],
        hidden: ['CS3216'],
      });
    });

    describe('deserializing edge cases', () => {
      test('duplicate module code', () => {
        expect(
          deserializeTimetable(
            'CS1010S=LEC:(1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13)&CS1010S=REC:(1|THU|1200|1300|S14-0619|1_2_3_4_5_6_7_8_9_10_11_12_13)',
            modules,
            semester,
          ).semTimetableConfig,
        ).toEqual({
          CS1010S: {
            Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
            Recitation: ['1|THU|1200|1300|S14-0619|1_2_3_4_5_6_7_8_9_10_11_12_13'],
          },
        } as SemTimetableConfig);
      });

      test('no lessons', () => {
        expect(
          deserializeTimetable(
            'GER1000&CS4243=LEC:&CS3216=LEC:)&CS1010S=LEC:()&ta=&hidden=',
            modules,
            semester,
          ).semTimetableConfig,
        ).toEqual({
          GER1000: {},
          CS4243: {
            Lecture: [],
          },
          CS3216: {
            Lecture: [],
          },
          CS1010S: {
            Lecture: [],
          },
        } as SemTimetableConfig);
      });

      test('missing module', () => {
        expect(
          deserializeTimetable(
            'GER1001&CS4244=&CS3217=LEC:&CS1011S=LEC:()&ta=&hidden=',
            modules,
            semester,
          ).semTimetableConfig,
        ).toEqual({} as SemTimetableConfig);
      });

      test('should ignore invalid lesson keys', () => {
        expect(
          deserializeTimetable(
            'CS1010S=LEC:(2|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13)',
            modules,
            semester,
          ).semTimetableConfig,
        ).toEqual({
          CS1010S: {
            Lecture: [],
          },
        });
      });
    });

    test('should return empty array if v2/v3 serialized', () => {
      expect(parseTaModuleCodes('(CS1010S,CS3216)')).toEqual([]);
    });
  });

  describe('v2 timetable serialization/deserialization', () => {
    test('deserializing timetable with ta and hidden modules', () => {
      expect(
        deserializeTimetable(
          'CS1010S=LEC:(0)&CS3216=LEC:(0)&ta=CS1010S&hidden=CS3216',
          modules,
          semester,
        ),
      ).toEqual({
        semTimetableConfig: {
          CS1010S: {
            Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
          },
          CS3216: {
            Lecture: ['1|MON|1830|2030|VCRm|1_2_3_4_5_6_7_8_9_10_11_12_13'],
          },
        },
        ta: ['CS1010S'],
        hidden: ['CS3216'],
      });
    });

    describe('deserializing edge cases', () => {
      test('duplicate module code', () => {
        expect(
          deserializeTimetable('CS1010S=LEC:(0)&CS1010S=REC:(1)', modules, semester)
            .semTimetableConfig,
        ).toEqual({
          CS1010S: {
            Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
            Recitation: ['1|THU|1200|1300|S14-0619|1_2_3_4_5_6_7_8_9_10_11_12_13'],
          },
        } as SemTimetableConfig);
      });

      test('should ignore invalid lesson indices', () => {
        expect(
          deserializeTimetable('CS1010S=LEC:(20)', modules, semester).semTimetableConfig,
        ).toEqual({
          CS1010S: {
            Lecture: [],
          },
        });
      });
    });
  });

  describe('deserialize v1 config', () => {
    test('deserialize v1', () => {
      expect(
        deserializeTimetable(
          'CS1010S=LEC:1,TUT:8&CS3216=LEC:1&ta=CS3216(LEC:1),CS1010S(LEC:1,TUT:2,TUT:3)&hidden=CS3216',
          modules,
          semester,
        ),
      ).toEqual({
        semTimetableConfig: {
          CS1010S: {
            Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
            Tutorial: [
              '2|MON|1000|1100|COM1-0217|3_4_5_6_7_8_9_10_11_12_13',
              '3|MON|1100|1200|COM1-0217|3_4_5_6_7_8_9_10_11_12_13',
            ],
          },
          CS3216: {
            Lecture: ['1|MON|1830|2030|VCRm|1_2_3_4_5_6_7_8_9_10_11_12_13'],
          },
        },
        ta: ['CS3216', 'CS1010S'],
        hidden: ['CS3216'],
      });
    });

    test('should ignore invalid lesson type', () => {
      expect(
        deserializeTimetable(
          'CS1010S=LEC:1&ta=CS1010S(TUT:2,INVALIDLESSONTYPE:1)',
          modules,
          semester,
        ),
      ).toEqual({
        semTimetableConfig: {
          CS1010S: {
            Tutorial: ['2|MON|1000|1100|COM1-0217|3_4_5_6_7_8_9_10_11_12_13'],
          },
        },
        ta: ['CS1010S'],
        hidden: [],
      });
    });

    test('should ignore invalid classNo', () => {
      expect(deserializeTimetable('CS1010S=LEC:INVALIDCLASSNO', modules, semester)).toEqual({
        semTimetableConfig: {
          CS1010S: {
            Lecture: [],
          },
        },
        ta: [],
        hidden: [],
      });
    });

    test('use only last ta param', () => {
      expect(
        deserializeTimetable('CS1010S=LEC:1&ta=CS3216(LEC:1)&ta=CS1010S(TUT:2)', modules, semester),
      ).toEqual({
        semTimetableConfig: {
          CS1010S: {
            Tutorial: ['2|MON|1000|1100|COM1-0217|3_4_5_6_7_8_9_10_11_12_13'],
          },
        },
        ta: ['CS1010S'],
        hidden: [],
      });
    });

    test('should ignore invalid ta lessons', () => {
      expect(deserializeTimetable('CS1010S=LEC:1&ta=CS1010S(LEC:2)', modules, semester)).toEqual({
        semTimetableConfig: {
          CS1010S: {
            Lecture: [],
          },
        },
        ta: ['CS1010S'],
        hidden: [],
      });
    });

    test('ta module config without lessons', () => {
      expect(deserializeTimetable('CS1010S=LEC:1,TUT:3&ta=CS1010S()', modules, semester)).toEqual({
        semTimetableConfig: {
          CS1010S: {},
        },
        ta: ['CS1010S'],
        hidden: [],
      });
    });

    test('ignore modules without semester data', () => {
      expect(
        deserializeTimetable('CS1010S=LEC:1,REC:1,TUT:3&ta=CS3217(LEC:1)', modules, semester),
      ).toEqual({
        semTimetableConfig: {
          CS1010S: {
            Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
            Recitation: ['1|THU|1200|1300|S14-0619|1_2_3_4_5_6_7_8_9_10_11_12_13'],
            Tutorial: ['3|MON|1100|1200|COM1-0217|3_4_5_6_7_8_9_10_11_12_13'],
          },
        },
        ta: [],
        hidden: [],
      });
    });

    test('should ignore invalid ta module config', () => {
      expect(
        deserializeTimetable(
          'CS1010S=LEC:1,REC:1,TUT:3&ta=INVALID),CS1010S(LEC:1)',
          modules,
          semester,
        ),
      ).toEqual({
        semTimetableConfig: {
          CS1010S: {
            Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
          },
        },
        ta: ['CS1010S'],
        hidden: [],
      });
    });

    test('should return array of module codes', () => {
      expect(parseTaModuleCodes('CS1010S(LEC:1,TUT:1),CS3216(LEC:1)')).toEqual([
        'CS1010S',
        'CS3216',
      ]);
    });
  });
});

describe(validateTimetableModules, () => {
  test('should leave valid modules untouched', () => {
    expect(validateTimetableModules({}, moduleCodeMap)).toEqual([{}, []]);
    expect(
      validateTimetableModules(
        {
          CS1010S: {},
          CS2100: {},
        },
        moduleCodeMap,
      ),
    ).toEqual([{ CS1010S: {}, CS2100: {} }, []]);
  });

  test('should remove invalid modules', () => {
    expect(
      validateTimetableModules(
        {
          DEADBEEF: {},
          CS2100: {},
        },
        moduleCodeMap,
      ),
    ).toEqual([{ CS2100: {} }, ['DEADBEEF']]);
  });
});

// TODO: validate module lessons
// - either normal non-TA or TA module
//   - remove lesson group if there are lessons of other lesson types
// - if module is a normal non TA module:
//   - remove lesson group if any lesson is missing
//   - remove lesson group if there are extra lessons
//
// describe(validateModuleLessons, () => {
//   const semester: Semester = 1;
//   const lessons: ModuleLessonConfig = {
//     Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
//     Recitation: ['1|THU|1200|1300|S14-0619|1_2_3_4_5_6_7_8_9_10_11_12_13'],
//     Tutorial: ['1|MON|0900|1000|COM1-0203|3_4_5_6_7_8_9_10_11_12_13'],
//   };

//   describe('validate non ta module lessons', () => {
//     test('should leave valid lessons untouched', () => {
//       expect(validateModuleLessons(semester, lessons, CS1010S, false)).toEqual({
//         validatedLessonConfig: lessons,
//         valid: true,
//       });
//     });

//     test('should remove lesson types which do not exist in module', () => {
//       expect(
//         validateModuleLessons(
//           semester,
//           {
//             ...lessons,
//             Laboratory: ['1|WED|1200|1400|LT32|1_2_3_4_5_6_7_8_9_10_11_12_13'], // CS1010S has no lab
//           },
//           CS1010S,
//           false,
//         ),
//       ).toEqual({ validatedLessonConfig: lessons, valid: false });
//     });

//     test('should replace lessons that have invalid class no', () => {
//       expect(
//         validateModuleLessons(
//           semester,
//           {
//             ...lessons,
//             Lecture: ['10|FRI|1300|1400|S14-0620|1_2_3_4_5_6_7_8_9_10_11_12_13'], // lesson is not a lecture
//           },
//           CS1010S,
//           false,
//         ),
//       ).toEqual({ validatedLessonConfig: lessons, valid: false });
//     });

//     test('should add lessons for when they are missing', () => {
//       expect(
//         validateModuleLessons(
//           semester,
//           {
//             Tutorial: ['1|MON|0900|1000|COM1-0203|3_4_5_6_7_8_9_10_11_12_13'],
//           },
//           CS1010S,
//           false,
//         ),
//       ).toEqual({
//         validatedLessonConfig: {
//           Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
//           Recitation: ['1|THU|1200|1300|S14-0619|1_2_3_4_5_6_7_8_9_10_11_12_13'],
//           Tutorial: ['1|MON|0900|1000|COM1-0203|3_4_5_6_7_8_9_10_11_12_13'],
//         },
//         valid: false,
//       });
//     });
//   });

//   describe('validate ta module lessons', () => {
//     test('should leave valid config untouched', () => {
//       expect(validateModuleLessons(semester, lessons, CS1010S, true)).toEqual({
//         validatedLessonConfig: lessons,
//         valid: true,
//       });
//     });

//     test('should remove lesson types which do not exist in module', () => {
//       expect(
//         validateModuleLessons(
//           semester,
//           {
//             ...lessons,
//             Laboratory: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
//           },
//           CS1010S,
//           true,
//         ),
//       ).toEqual({
//         validatedLessonConfig: lessons,
//         valid: false,
//       });
//     });

//     test('should replace lessons that have invalid class no', () => {
//       expect(
//         validateModuleLessons(
//           semester,
//           {
//             ...lessons,
//             Lecture: ['1|THU|1200|1300|S14-0619|1_2_3_4_5_6_7_8_9_10_11_12_13'], // lesson is not a lecture
//           },
//           CS1010S,
//           true,
//         ),
//       ).toEqual({
//         validatedLessonConfig: lessons,
//         valid: false,
//       });
//     });
//   });
// });

describe(formatNumericWeeks, () => {
  it('should return null if every week is given', () => {
    expect(formatNumericWeeks(EVERY_WEEK)).toBeNull();
  });

  it('should return even/odd weeks', () => {
    expect(formatNumericWeeks(ODD_WEEK)).toEqual('Odd Weeks');
    expect(formatNumericWeeks(EVEN_WEEK)).toEqual('Even Weeks');
  });

  it('should abbreviate consecutive week numbers', () => {
    expect(formatNumericWeeks([1])).toEqual('Week 1');
    expect(formatNumericWeeks([1, 2, 3, 4])).toEqual('Weeks 1-4');
    expect(formatNumericWeeks([1, 2, 3, 4, 6, 7, 8, 9])).toEqual('Weeks 1-4, 6-9');
    expect(formatNumericWeeks([1, 3, 5])).toEqual('Weeks 1, 3, 5');
    expect(formatNumericWeeks([1, 2, 4, 5, 6, 7])).toEqual('Weeks 1, 2, 4-7');
    expect(formatNumericWeeks([1, 2, 4, 5])).toEqual('Weeks 1, 2, 4, 5');
  });
});

describe(isLessonAvailable, () => {
  function testLessonAvailable(weeks: Weeks, date: Date) {
    return isLessonAvailable(
      { ...createGenericLesson(), weeks },
      date,
      NUSModerator.academicCalendar.getAcadWeekInfo(date),
    );
  }

  test("should return false if the lesson's Weeks does not match the week number", () => {
    expect(
      testLessonAvailable(
        [1, 3, 5, 7, 9, 11],
        // Week 5
        parseISO('2017-09-11'),
      ),
    ).toBe(true);

    expect(
      testLessonAvailable(
        [1, 2, 3],
        // Week 4
        parseISO('2017-09-04'),
      ),
    ).toBe(false);

    expect(
      testLessonAvailable(
        [1, 3, 5, 7, 9, 11],
        // Week 5
        parseISO('2017-09-11'),
      ),
    ).toBe(true);
  });

  test('should return false if the date falls outside the week range', () => {
    expect(
      testLessonAvailable(
        { start: '2017-08-07', end: '2017-10-17' },
        // Week 5
        parseISO('2017-09-11'),
      ),
    ).toBe(true);
  });
});

describe(isLessonOngoing, () => {
  test('should return whether a lesson is ongoing', () => {
    const lesson = createGenericLesson();
    expect(isLessonOngoing(lesson, 759)).toBe(false);
    expect(isLessonOngoing(lesson, 800)).toBe(true);
    expect(isLessonOngoing(lesson, 805)).toBe(true);
    expect(isLessonOngoing(lesson, 959)).toBe(true);
    expect(isLessonOngoing(lesson, 1000)).toBe(false);
  });
});

describe(getStartTimeAsDate, () => {
  test('should return start time as date', () => {
    const date = new Date(2018, 5, 10);
    const lesson = createGenericLesson('Monday', '0830', '1045');
    expect(getStartTimeAsDate(lesson, date)).toEqual(new Date(2018, 5, 10, 8, 30));
  });
});

describe(getEndTimeAsDate, () => {
  test('should return end time as date', () => {
    const date = new Date(2018, 5, 10);
    const lesson = createGenericLesson('Monday', '0830', '1045');
    expect(getEndTimeAsDate(lesson, date)).toEqual(new Date(2018, 5, 10, 10, 45));
  });
});

describe('v1 config migration', () => {
  const moduleLessonConfig = {
    Lecture: '1',
  };
  const moduleTimetable = getModuleTimetable(CS1010S, 1);
  const lessonMap = getModuleLessonMap(CS1010S, 1);
  test('should do nothing if already migrated', () => {
    const migrationResult = migrateModuleLessonConfig(
      {
        Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
      },
      [],
      'CS1010S',
      moduleTimetable,
      lessonMap,
    );
    expect(migrationResult).toEqual({
      migratedModuleLessonConfig: {
        Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
      },
      alreadyMigrated: true,
    });
  });

  test('should not error if ta module config was migrated but module lesson config was not', () => {
    const migrationResult = migrateModuleLessonConfig(
      moduleLessonConfig,
      [],
      'CS1010S',
      moduleTimetable,
      lessonMap,
    );
    expect(migrationResult).toEqual({
      migratedModuleLessonConfig: {
        Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'],
      },
      alreadyMigrated: false,
    });
  });
});

describe(getClosestLessonConfig, () => {
  test('ignore if lesson type has no classNo', () => {
    expect(
      getClosestLessonConfig(
        { Lecture: {} },
        { Lecture: ['1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13'] },
      ),
    ).toEqual({});
  });
});

describe(getRecoveryLessonKeys, () => {
  test('guard against empty lessons input', () => {
    expect(getRecoveryLessonKeys({})).toEqual([]);
  });
});
