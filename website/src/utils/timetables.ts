import { AcadWeekInfo } from 'nusmoderator';
import {
  castArray,
  filter,
  first,
  flatMapDeep,
  fromPairs,
  get,
  groupBy,
  invert,
  isArray,
  isEmpty,
  isEqual,
  isNumber,
  isUndefined,
  keys,
  last,
  map,
  mapKeys,
  mapValues,
  maxBy,
  omit,
  omitBy,
  partition,
  pick,
  pickBy,
  range,
  reduce,
  reject,
  sample,
  size,
  some,
  toPairs,
  values,
} from 'lodash-es';
import { addDays, min as minDate, parseISO, startOfDay } from 'date-fns';
import qs from 'query-string';

import {
  LessonType,
  Module,
  ModuleCode,
  NumericWeeks,
  RawLesson,
  Semester,
  ClassNo,
  isWeekRange,
  LessonKey,
  LessonMap,
  Weeks,
  WeekRange,
} from 'types/modules';

import {
  ModuleLessonConfigV1,
  SemTimetableConfigV1,
  TaModulesConfigV1,
  ColoredLesson,
  HoverLesson,
  InteractableLesson,
  Lesson,
  ModuleLessonConfig,
  ModuleLessonConfigWithLessons,
  SemTimetableConfig,
  SemTimetableConfigWithLessons,
  TimetableDayArrangement,
  TimetableDayFormat,
  TimetableArrangement,
  ValidationResult,
  LessonModification,
} from 'types/timetables';

import { ColorMapping, ModuleCodeMap, ModulesMap } from 'types/reducers';
import { ExamClashes } from 'types/views';

import { getTimeAsDate } from './timify';
import { getModuleTimetable, getExamDate, getExamDuration, getModuleLessonMap } from './modules';
import { deltas } from './array';

export type lessonTypeAbbrev = { [lessonType: string]: string };
export const LESSON_TYPE_ABBREV: lessonTypeAbbrev = {
  'Design Lecture': 'DLEC',
  Laboratory: 'LAB',
  Lecture: 'LEC',
  'Packaged Laboratory': 'PLAB',
  'Packaged Lecture': 'PLEC',
  'Packaged Tutorial': 'PTUT',
  Recitation: 'REC',
  'Sectional Teaching': 'SEC',
  'Seminar-Style Module Class': 'SEM',
  Tutorial: 'TUT',
  'Tutorial Type 2': 'TUT2',
  'Tutorial Type 3': 'TUT3',
  Workshop: 'WS',
};

type DayOfWeek = 'Monday' | 'Tuesday' | 'Wednesday' | 'Thursday' | 'Friday' | 'Saturday' | 'Sunday';
export const DAY_OF_WEEK_ABBREV: { [x in DayOfWeek]: string } = {
  Monday: 'MON',
  Tuesday: 'TUE',
  Wednesday: 'WED',
  Thursday: 'THU',
  Friday: 'FRI',
  Saturday: 'SAT',
  Sunday: 'SUN',
};
const DAY_OF_WEEK_FULL = invert(DAY_OF_WEEK_ABBREV);

// Reverse lookup map of LESSON_TYPE_ABBREV
export const LESSON_ABBREV_TYPE: { [key: string]: LessonType } = invert(LESSON_TYPE_ABBREV);

// Used for module config serialization - these must be query string safe
// See: https://stackoverflow.com/a/31300627
export const LESSON_TYPE_SEP = ';';
export const LESSON_TYPE_KEY_VALUE_SEP = ':';
export const LESSON_SEP = ',';

export const MODULE_SEP = ',';

const EMPTY_OBJECT = {};

export function isValidSemester(semester: Semester): boolean {
  return semester >= 1 && semester <= 4;
}

//  Returns a random configuration of a module's timetable lessons.
//  Used when a module is first added.
//  TODO: Suggest a configuration that does not clash with itself.
//  {
//    [lessonType: string]: ClassNo,
//  }
export function randomModuleLessonConfig(lessons: readonly RawLesson[]): ModuleLessonConfig {
  const lessonsWithSerializedDetails = map(lessons, (lesson) => ({
    ...lesson,
    serializedLessonDetails: serializeLessonDetails(lesson),
  }));

  const lessonByGroups: { [lessonType: string]: readonly RawLesson[] } = groupBy(
    lessonsWithSerializedDetails,
    (lesson) => lesson.lessonType,
  );

  const lessonByGroupsByClassNo: {
    [lessonType: string]: { [classNo: string]: readonly RawLesson[] };
  } = mapValues(lessonByGroups, (lessonsOfSamelessonType: readonly RawLesson[]) =>
    groupBy(lessonsOfSamelessonType, (lesson) => lesson.classNo),
  );

  return mapValues(
    lessonByGroupsByClassNo,
    (group: { [classNo: string]: readonly RawLesson[] }) => {
      const randomlySelectedLessons = sample(group);
      return map(randomlySelectedLessons, 'serializedLessonDetails');
    },
  );
}

// Replaces ClassNo in SemTimetableConfig with Array<Lesson>
export function hydrateSemTimetableWithLessons(
  semTimetableConfig: SemTimetableConfig,
  modules: ModulesMap,
  semester: Semester,
): SemTimetableConfigWithLessons<Lesson & ValidationResult> {
  return mapValues(
    semTimetableConfig,
    (moduleLessonConfig: ModuleLessonConfig, moduleCode: ModuleCode) => {
      const module: Module = modules[moduleCode];
      if (!module) return EMPTY_OBJECT;

      return hydrateModuleConfigWithLessons(moduleLessonConfig, module, semester);
    },
  );
}

// Replaces ClassNo in ModuleLessonConfig with Array<Lesson>
function hydrateModuleConfigWithLessons(
  moduleLessonConfig: ModuleLessonConfig,
  module: Module,
  semester: Semester,
): ModuleLessonConfigWithLessons<Lesson & ValidationResult> {
  const lessonMap = getModuleLessonMap(module, semester);
  return mapValues(moduleLessonConfig, (lessonKeys: LessonKey[], lessonType: LessonType) => {
    const lessonsWithLessonType: Record<LessonKey, RawLesson> = get(lessonMap, lessonType, {});
    const validLessonKeys = keys(lessonsWithLessonType);

    const [validConfigLessonKeys, invalidConfigLessonKeys] = partition(
      lessonKeys,
      (configLessonKey) => validLessonKeys.includes(configLessonKey),
    );

    const validConfigRawLessons: Record<LessonKey, RawLesson> = pick(
      lessonsWithLessonType,
      validConfigLessonKeys,
    );
    const validConfigLessons = mapValues(validConfigRawLessons, (lesson: RawLesson) => ({
      ...lesson,
      moduleCode: module.moduleCode,
      title: module.title,
      valid: true,
    }));

    if (invalidConfigLessonKeys.length < 1) {
      return validConfigLessons;
    }

    const invalidConfigRawLessons: Record<LessonKey, RawLesson> = reduce(
      invalidConfigLessonKeys,
      (accumulated, invalidConfigLessonKey) => {
        return {
          ...accumulated,
          invalidConfigLessonKey: {
            ...deserializeLessonDetails(invalidConfigLessonKey),
            lessonType,
          },
        };
      },
      {},
    );
    const invalidConfigLessons = mapValues(invalidConfigRawLessons, (lesson: RawLesson) => ({
      ...lesson,
      moduleCode: module.moduleCode,
      title: module.title,
      valid: false,
    }));

    return {
      ...validConfigLessons,
      ...invalidConfigLessons,
    };
  });
}

//  Filters a flat array of lessons and returns the lessons corresponding to lessonType.
export function lessonsForLessonType<T extends RawLesson>(
  lessons: readonly T[],
  lessonType: LessonType,
): readonly T[] {
  return lessons.filter((lesson) => lesson.lessonType === lessonType);
}

//  Converts from timetable config format to flat array of lessons.
//  {
//    [moduleCode: string]: {
//      [lessonType: string]: [Lesson, Lesson, ...],
//      [lessonType: string]: [Lesson, ...],
//    }
//  }
export function timetableLessonsArray<T extends Lesson>(
  timetable: SemTimetableConfigWithLessons<T>,
): T[] {
  return flatMapDeep(timetable, (moduleLessonConfig) => flatMapDeep(moduleLessonConfig, values));
}

//  Groups flat array of lessons by day.
//  {
//    Monday: [Lesson, Lesson, ...],
//    Tuesday: [Lesson, ...],
//  }
export function groupLessonsByDay<T extends RawLesson>(lessons: T[]): TimetableDayFormat<T> {
  return groupBy(lessons, (lesson) => lesson.day);
}

//  Determines if two lessons overlap:
export function doLessonsOverlap(lesson1: RawLesson, lesson2: RawLesson): boolean {
  return (
    lesson1.day === lesson2.day &&
    lesson1.startTime < lesson2.endTime &&
    lesson2.startTime < lesson1.endTime
  );
}

//  Converts a flat array of lessons *for ONE day* into rows of lessons within that day row.
//  Result invariants:
//  - Each lesson will not overlap with each other.
//  [
//    [Lesson, Lesson, ...],
//    [Lesson, ...],
//  ]
export function arrangeLessonsWithinDay<T extends RawLesson>(
  lessons: T[],
): TimetableDayArrangement<T> {
  const rows: T[][] = [[]];
  if (isEmpty(lessons)) {
    return rows;
  }
  const sortedLessons = lessons.sort((a, b) => {
    const timeDiff = a.startTime.localeCompare(b.startTime);
    return timeDiff !== 0 ? timeDiff : a.classNo.localeCompare(b.classNo);
  });
  sortedLessons.forEach((lesson: T) => {
    for (let i = 0; i < rows.length; i++) {
      const rowLessons: T[] = rows[i];
      const previousLesson = last(rowLessons);
      if (!previousLesson || !doLessonsOverlap(previousLesson, lesson)) {
        // Lesson does not overlap with any Lesson in the row. Add it to row.
        rowLessons.push(lesson);
        return;
      }
    }
    // No existing rows are available to fit this lesson in. Append a new row.
    rows.push([lesson]);
  });

  return rows;
}

//  Accepts a flat array of lessons and groups them by day and rows with each day
//  for rendering on the timetable.
//  Clashes in Array<Lesson> will go onto the next row within that day.
//  {
//    Monday: [
//      [Lesson, Lesson, ...],
//    ],
//    Tuesday: [
//      [Lesson, Lesson, Lesson, ...],
//      [Lesson, Lesson, ...],
//      [Lesson, ...],
//    ],
//    ...
//  }
export function arrangeLessonsForWeek<T extends RawLesson>(lessons: T[]): TimetableArrangement<T> {
  const dayLessons = groupLessonsByDay(lessons);
  return mapValues(dayLessons, (dayLesson: T[]) => arrangeLessonsWithinDay(dayLesson));
}

// Determines if a Lesson on the timetable can be modifiable / dragged around.
// Condition: There are multiple ClassNo for all the Array<Lesson> in a lessonType.
export function areOtherClassesAvailable(
  lessons: readonly RawLesson[],
  lessonType: LessonType,
): boolean {
  const lessonTypeGroups = groupBy<RawLesson>(lessons, (lesson) => lesson.lessonType);
  if (!lessonTypeGroups[lessonType]) {
    // No such lessonType.
    return false;
  }
  return Object.keys(groupBy(lessonTypeGroups[lessonType], (lesson) => lesson.classNo)).length > 1;
}

// Creates a key using only the exam date string (without time)
export function getExamDateOnly(module: Module, semester: Semester): string | undefined {
  const examDateTime = getExamDate(module, semester);
  return examDateTime?.slice(0, 10);
}

// Returns the start time of the exam as an epoch time (number). Throws an error if the module
// does not have an exam date.
export function getValidExamStartTimeAsEpoch(module: Module, semester: Semester): number {
  const startTimeString = getExamDate(module, semester);
  if (startTimeString === null) {
    throw new Error('Courses tested for clashes must have exam dates and durations!');
  }
  return new Date(startTimeString).getTime();
}

// Returns the end time of the exam as an epoch time (number). Throws an error if the module
// does not have an exam date or duration.
export function getValidExamEndTimeAsEpoch(module: Module, semester: Semester): number {
  const duration = getExamDuration(module, semester);
  if (duration === null) {
    throw new Error('Courses tested for clashes must have exam dates and durations!');
  }
  const startEpoch = getValidExamStartTimeAsEpoch(module, semester);
  return startEpoch + duration * 60 * 1000;
}

// Find all exam clashes between modules in semester
// Returns object associating exam dates with the modules clashing on those dates
export function findExamClashes(modules: Module[], semester: Semester): ExamClashes {
  // Filter away modules without exam dates or exam durations
  const filteredModules = modules.filter(
    (module) =>
      getExamDate(module, semester) !== null && getExamDuration(module, semester) !== null,
  );

  const groupedModules = groupBy(filteredModules, (module) => getExamDateOnly(module, semester));

  const clashes: ExamClashes = {};

  Object.values(groupedModules).forEach((sameDayMods) => {
    // Sort sameDayMods by exam start time
    sameDayMods.sort((a, b) => {
      const aStartEpoch = getValidExamStartTimeAsEpoch(a, semester);
      const bStartEpoch = getValidExamStartTimeAsEpoch(b, semester);

      // Use end time as secondary key
      const aEndEpoch = getValidExamEndTimeAsEpoch(a, semester);
      const bEndEpoch = getValidExamEndTimeAsEpoch(b, semester);

      if (aStartEpoch === bStartEpoch) {
        return aEndEpoch - bEndEpoch;
      }

      return aStartEpoch - bStartEpoch;
    });

    // Initialize an empty list to hold the groups of overlapping intervals
    // Each group will itself be a list of intervals
    const overlappingGroups: Module[][] = [];

    let currentOverlapEnd = 0;
    let currentOverlappingMods: Module[] = [];

    sameDayMods.forEach((mod, modIndex) => {
      if (modIndex > 0 && getValidExamStartTimeAsEpoch(mod, semester) < currentOverlapEnd) {
        currentOverlappingMods.push(mod);
      } else {
        // The current course does not overlap with the current group, so we reset
        // the current group and start a new one
        if (currentOverlappingMods.length > 1) {
          // If the current group has more than one module, we add it to the list of clashes
          overlappingGroups.push(currentOverlappingMods);
        }
        currentOverlapEnd = getValidExamEndTimeAsEpoch(mod, semester);
        currentOverlappingMods = [mod];
      }
    });

    // Add the last group to the list of clashes if applicable
    if (currentOverlappingMods.length > 1) {
      overlappingGroups.push(currentOverlappingMods);
    }

    overlappingGroups.forEach((group) => {
      // Displayed clashing date and time, which is the start time of the last module in the group
      const clashingDateTime = getExamDate(group[group.length - 1], semester);

      if (clashingDateTime === null) {
        throw new Error('Courses tested for clashes must have exam dates and durations!');
      }

      // Populate the clashes object to be returned
      group.forEach((mod) => {
        if (!clashes[clashingDateTime]) {
          clashes[clashingDateTime] = [mod];
        } else {
          clashes[clashingDateTime].push(mod);
        }
      });
    });
  });

  return clashes;
}

export function isLessonAvailable(
  lesson: Lesson,
  date: Date,
  weekInfo: Readonly<AcadWeekInfo>,
): boolean {
  const weeks = lesson.weeks;

  if (isWeekRange(weeks)) {
    const end = minDate([parseISO(weeks.end), date]);
    for (let current = parseISO(weeks.start); current <= end; current = addDays(current, 7)) {
      if (isEqual(current, startOfDay(date))) return true;
    }

    return false;
  }

  return weeks.includes(weekInfo.num as number);
}

export function isLessonOngoing(lesson: Lesson, currentTime: number): boolean {
  return (
    parseInt(lesson.startTime, 10) <= currentTime && currentTime < parseInt(lesson.endTime, 10)
  );
}

export function getStartTimeAsDate(lesson: Lesson, date: Date = new Date()): Date {
  return getTimeAsDate(lesson.startTime, date);
}

export function getEndTimeAsDate(lesson: Lesson, date: Date = new Date()): Date {
  return getTimeAsDate(lesson.endTime, date);
}

/**
 * Validates the modules in a timetable. It removes all modules which do not exist in
 * the provided module code map from the timetable and returns that as the first item
 * in the tuple, and the module code of all removed modules as the second item.
 *
 * @param timetable
 * @param moduleCodes
 * @returns {[SemTimetableConfig, ModuleCode[]]}
 */
export function validateTimetableModules(
  timetable: SemTimetableConfig,
  moduleCodes: ModuleCodeMap,
): [SemTimetableConfig, ModuleCode[]] {
  const [valid, invalid] = partition(
    Object.keys(timetable),
    (moduleCode: ModuleCode) => moduleCodes[moduleCode],
  );
  return [pick(timetable, valid), invalid];
}

/**
 * Validates TA module's {@link ModuleLessonConfig|lesson configs} based on a list of lessons to provide the lesson type info of each lesson
 *
 * Valid TA modules configs must have lesson indices that belong to the correct lesson type
 * @param lessonConfig {@link ModuleLessonConfig|lesson configs} to validate
 * @param validLessons {@link RawLessonWithIndex|lesson}s to validate against
 * @returns
 * - validated TA modules' {@link ModuleLessonConfig|lesson config}
 * - whether the input is valid, to signal to skip dispatch
 */
export function validateTaModuleLessons(
  lessonConfig: ModuleLessonConfig,
  lessonMap: Readonly<LessonMap<RawLesson>>,
): {
  validatedLessonConfig: ModuleLessonConfig;
  valid: boolean;
} {
  const { config: validatedLessonConfig, valid } = reduce(
    lessonConfig,
    (accumulatedValidationResult, configLessonTypeLessonKeys, lessonType) => {
      const validLessonTypeLessonKeys: LessonKey[] = keys(get(lessonMap, lessonType, {}));
      if (!validLessonTypeLessonKeys.length) {
        return {
          config: accumulatedValidationResult.config,
          valid: false,
        };
      }
      const hasInvalidLesson = some(
        configLessonTypeLessonKeys,
        (lessonKey) => !validLessonTypeLessonKeys.includes(lessonKey),
      );
      return {
        config: {
          ...accumulatedValidationResult.config,
          [lessonType]: configLessonTypeLessonKeys,
        },
        valid: accumulatedValidationResult.valid && !hasInvalidLesson,
      };
    },
    { config: {}, valid: true } as { config: ModuleLessonConfig; valid: boolean },
  );

  return {
    validatedLessonConfig,
    valid,
  };
}

/**
 * Used to recover from the config of a lesson type that contains invalid lesson indices
 * @param validLessons lessons with the same lesson type to generate a valid lesson config from
 * @returns lesson indices of the generated valid lesson config
 *
 * Note: the current implementation generates a config containing lessons belonging to the first classNo in the provided lessons
 */
export function getRecoveryLessons(
  validLessons: Record<LessonKey, RawLesson>,
): Record<LessonKey, RawLesson> {
  const firstClass = first(map(validLessons));
  if (!firstClass) {
    return {};
  }
  return pickBy(validLessons, (lesson) => lesson.classNo === firstClass.classNo);
}

function deserializeLessonTypeLessons(
  lessonType: LessonType,
  lessonKeys: LessonKey[],
): Record<LessonKey, RawLesson> {
  return reduce(
    lessonKeys,
    (accumulatedLessons, lessonKey) => {
      return {
        ...accumulatedLessons,
        [lessonKey]: {
          ...deserializeLessonDetails(lessonKey),
          lessonType,
        },
      };
    },
    {},
  );
}

type PartialLessonMappings = {
  mappedLessons: [RawLesson, RawLesson][];
  remainingLessonsBefore: Record<LessonKey, RawLesson>;
  remainingLessonsAfter: Record<LessonKey, RawLesson>;
};

function sameTimeMappings({
  mappedLessons,
  remainingLessonsBefore,
  remainingLessonsAfter,
}: PartialLessonMappings) {
  return reduce(
    remainingLessonsAfter,
    (accumulated, lessonAfter, lessonAfterKey) => {
      const sameTimeAndDayLessons = omitBy(remainingLessonsBefore, (lessonBefore) =>
        some([
          lessonBefore.day !== lessonAfter.day,
          lessonBefore.startTime !== lessonAfter.startTime,
          lessonBefore.endTime !== lessonAfter.endTime,
        ]),
      );

      if (size(sameTimeAndDayLessons) === 1) {
        const { mappedLessons, remainingLessonsBefore, remainingLessonsAfter } = accumulated;
        const [lessonBeforeKey, lessonBefore] = toPairs(sameTimeAndDayLessons)[0];

        return {
          mappedLessons: [...mappedLessons, [lessonAfter, lessonBefore] as [RawLesson, RawLesson]],
          remainingLessonsBefore: omit(remainingLessonsBefore, lessonBeforeKey),
          remainingLessonsAfter: omit(remainingLessonsAfter, lessonAfterKey),
        };
      }

      return accumulated;
    },
    {
      mappedLessons,
      remainingLessonsBefore,
      remainingLessonsAfter,
    } as PartialLessonMappings,
  );
}

function mapOriginalLessonsToModified(
  original: Record<LessonKey, RawLesson>,
  modified: Record<LessonKey, RawLesson>,
): LessonModification[] {
  const lessonsBefore = pickBy(
    original,
    (_lesson, lessonKey) => !modified.hasOwnProperty(lessonKey),
  );
  const lessonsAfter = pickBy(
    modified,
    (_lesson, lessonKey) => !original.hasOwnProperty(lessonKey),
  );

  const mappingWithSameTimeLessonsMapped = sameTimeMappings({
    mappedLessons: [],
    remainingLessonsBefore: lessonsBefore,
    remainingLessonsAfter: lessonsAfter,
  });

  const { mappedLessons, remainingLessonsBefore, remainingLessonsAfter } =
    mappingWithSameTimeLessonsMapped;
  const mappableLessonModifications = reduce(
    mappedLessons,
    (accumulated, [lessonAfter, lessonBefore]) => {
      const changedFields = reduce(
        lessonAfter,
        (accumulated, valueAfter, key) => {
          const valueBefore = lessonBefore[key as keyof RawLesson];

          if (valueBefore === valueAfter) return [...accumulated, key as keyof RawLesson];

          return accumulated;
        },
        [] as (keyof RawLesson)[],
      );

      return [
        ...accumulated,
        {
          before: lessonBefore,
          after: lessonAfter,
          changedFields,
        },
      ];
    },
    [] as LessonModification[],
  );

  const unmappedLessonsBefore: LessonModification[] = map(
    remainingLessonsBefore,
    (lessonBefore) => ({
      before: lessonBefore,
      after: null,
      changedFields: null,
    }),
  );

  const unmappedLessonsAfter: LessonModification[] = map(remainingLessonsAfter, (lessonAfter) => ({
    before: null,
    after: lessonAfter,
    changedFields: null,
  }));

  return [...mappableLessonModifications, ...unmappedLessonsBefore, ...unmappedLessonsAfter];
}

/**
 * Valid non-TA modules must have one and only one classNo for each lesson type
 * @param lessonConfig lesson configs to validate
 * @param validLessons lessons to validate against
 * @returns
 * - validated non-TA lesson config
 * - whether the input is valid, to signal to skip dispatch
 */
export function validateNonTaModuleLesson(
  lessonConfig: ModuleLessonConfig,
  lessonMap: Readonly<LessonMap<RawLesson>>,
): {
  validatedLessonConfig: ModuleLessonConfig;
  modifications: Record<LessonType, LessonModification[]>;
} {
  const lessonTypesInLessonConfig = keys(lessonConfig);
  const { config: validatedLessonConfig, modifications } = reduce(
    lessonMap,
    ({ config, modifications }, lessonTypeValidLessons, lessonType) => {
      const lessonTypeInLessonConfig = lessonTypesInLessonConfig.includes(lessonType);
      const configLessonKeys: LessonKey[] = lessonConfig[lessonType];
      const firstLessonKey = first(configLessonKeys);

      if (!lessonTypeInLessonConfig || !firstLessonKey) {
        const configLessons: Record<LessonKey, RawLesson> = deserializeLessonTypeLessons(
          lessonType,
          configLessonKeys,
        );
        const recoveryLessons: Record<LessonKey, RawLesson> =
          getRecoveryLessons(lessonTypeValidLessons);
        const lessonModifications = mapOriginalLessonsToModified(configLessons, recoveryLessons);

        return {
          config: {
            ...config,
            [lessonType]: keys(recoveryLessons),
          },
          modifications: {
            ...modifications,
            [lessonType]: lessonModifications,
          },
        };
      }

      const classNo = deserializeLessonDetails(firstLessonKey).classNo;
      const validLessons: Record<LessonKey, RawLesson> = pickBy(
        lessonTypeValidLessons,
        (lesson) => lesson.classNo === classNo,
      );

      if (new Set(keys(validLessons)) === new Set(configLessonKeys))
        return {
          config,
          modifications,
        };

      const lessonModifications = mapOriginalLessonsToModified(
        deserializeLessonTypeLessons(lessonType, configLessonKeys),
        validLessons,
      );

      return {
        config: {
          ...config,
          [lessonType]: keys(validLessons),
        },
        modifications: {
          ...modifications,
          [lessonType]: lessonModifications,
        },
      };
    },
    { config: {}, modifications: {} } as {
      config: ModuleLessonConfig;
      modifications: Record<LessonType, LessonModification[]>;
    },
  );

  const validLessonTypes = keys(validatedLessonConfig);
  const invalidLessonTypes = reject(lessonTypesInLessonConfig, (lessonType) =>
    validLessonTypes.includes(lessonType),
  );
  const removedLessonTypesConfigs = reduce(
    invalidLessonTypes,
    (accumulated, invalidLessonType) => {
      return {
        ...accumulated,
        [invalidLessonType]: [] as LessonModification[],
      };
    },
    {} as Record<LessonType, LessonModification[]>,
  );

  return {
    validatedLessonConfig,
    modifications: {
      ...modifications,
      ...removedLessonTypesConfigs,
    },
  };
}

/**
 * Validates the lesson config for a specific module. It replaces all lessons
 * which invalid class number with the first available class numbers, and
 * removes lessons that are no longer valid
 * @param semester
 * @param lessonConfig
 * @param module
 */
export function validateModuleLessons(
  semester: Semester,
  lessonConfig: ModuleLessonConfig,
  module: Module,
  isTa: boolean,
): {
  validatedLessonConfig: ModuleLessonConfig;
  modifications: Record<LessonType, LessonModification[]>;
} {
  const lessonMap = getModuleLessonMap(module, semester);

  if (isTa)
    return {
      validatedLessonConfig: lessonConfig,
      modifications: {},
    };

  return validateNonTaModuleLesson(lessonConfig, lessonMap);
}

/**
 * Group lessons by lesson types
 * @param lessons lessons to group
 * @returns lesson keys, not lessons
 */
export const makeLessonMap = <T extends RawLesson>(lessons: readonly T[]): LessonMap<T> => {
  const lessonsByLessonType = groupBy(lessons, 'lessonType');
  return mapValues(lessonsByLessonType, (lessonsWithLessonType) =>
    fromPairs(map(lessonsWithLessonType, (lesson) => [serializeLessonDetails(lesson), lesson])),
  );
};

// Get information for all modules present in a semester timetable config
export function getSemesterModules(
  timetable: { [moduleCode: string]: unknown },
  modules: ModulesMap,
): Module[] {
  return values(pick(modules, Object.keys(timetable)));
}

/**
 * Formats numeric week number array into something human readable
 *
 * - 1           => Week 1
 * - 1,2         => Weeks 1,2
 * - 1,2,3       => Weeks 1-3
 * - 1,2,3,5,6,7 => Weeks 1-3, 5-7
 */
export function formatNumericWeeks(unprocessedWeeks: NumericWeeks): string | null {
  // Ensure list of weeks are unique
  const weeks = unprocessedWeeks.filter(
    (value, index) => unprocessedWeeks.indexOf(value) === index,
  );

  if (weeks.length === 13) return null;
  if (weeks.length === 1) return `Week ${weeks[0]}`;

  // Check for odd / even weeks. There are more odd weeks then even weeks, so we have to split
  // the length check.
  if (deltas(weeks).every((d) => d === 2)) {
    if (weeks[0] % 2 === 0 && weeks.length >= 6) return 'Even Weeks';
    if (weeks[0] % 2 === 1 && weeks.length >= 7) return 'Odd Weeks';
  }

  // Merge consecutive
  const processed: (number | string)[] = [];
  let start = weeks[0];
  let end = start;

  const mergeConsecutive = () => {
    if (end - start > 2) {
      processed.push(`${start}-${end}`);
    } else {
      processed.push(...range(start, end + 1));
    }
  };

  weeks.slice(1).forEach((next) => {
    if (next - end <= 1) {
      // Consecutive week number - keep going
      end = next;
    } else {
      // Break = push the current chunk into processed
      mergeConsecutive();
      start = next;
      end = start;
    }
  });

  mergeConsecutive();

  return `Weeks ${processed.join(', ')}`;
}

/**
 * Serializes a module's lesson config for sharing\
 * Given input `{ Lecture: [0], Tutorial: [1] }`\
 * Will output `LEC:(0),TUT:(1)`
 */
function serializeModuleConfig(config: ModuleLessonConfig): string {
  return map(
    config,
    (serializedLessonDetails, lessonType) =>
      `${LESSON_TYPE_ABBREV[lessonType]}${LESSON_TYPE_KEY_VALUE_SEP}(${serializedLessonDetails.join(
        LESSON_SEP,
      )})`,
  ).join(';');
}

/**
 * Converts a timetable config to query string\
 * Given input
 * ```
 * {
 *   CS2104: { Lecture: [0], Tutorial: [1] },
 *   CS2107: { Lecture: [0], Tutorial: [1] },
 * }
 * ```
 * Will output `CS2104=LEC:(0),TUT:(1)&CS2107=LEC:(0),TUT:(1)`
 */
export function serializeTimetable(timetable: SemTimetableConfig): string {
  // We are using query string safe characters, so this encoding is unnecessary
  return qs.stringify(mapValues(timetable, serializeModuleConfig), { encode: false });
}

/**
 * Serializes TA modules for sharing\
 * Given input `["CS1010S", "CS3216"]`\
 * Will output `&ta=CS1010S,CS3216`
 */
export function serializeModuleList(modules: ModuleCode[]): string {
  return isEmpty(modules) ? '' : modules.join(MODULE_SEP);
}

/**
 * Parses a serialized v1 format TA config for module codes\
 * Does not error if the TA module config includes a module code not inside the non-TA module config\
 * @param taSerialized e.g. `CS2100(TUT:2,TUT:3,LAB:1),CS2107(TUT:8)`
 * @returns TA module codes if the module lesson config is v1 format serialized (e.g. `["CS2100","CS2107"]`)\
 * Otherwise, returns an empty array
 */
export function parseTaModuleCodes(taSerialized?: string | null): ModuleCode[] {
  if (!taSerialized || taSerialized[0] === '(') return [];
  // CS2100(TUT:2,TUT:3,LAB:1),CS2107(TUT:8)
  const serializedTaModuleLessonConfigs = taSerialized.split(/(?<=\)),/);
  // CS2100(TUT:2,TUT:3,LAB:1)
  // CS2107(TUT:8)
  return reduce(
    serializedTaModuleLessonConfigs,
    (accumulatedTaModuleCodes, serializedTaModuleLessonConfig) => {
      const moduleCode = serializedTaModuleLessonConfig.match(/(.*)(?=\()/);
      if (!moduleCode || moduleCode.length !== 2) {
        return accumulatedTaModuleCodes;
      }
      return [...accumulatedTaModuleCodes, moduleCode[0]];
    },
    [] as ModuleCode[],
  );
}

/**
 * Deserializes a serialized v1 format TA config to a module lesson config
 * @param taSerialized e.g. `CS2100(TUT:2,TUT:3,LAB:1),CS2107(TUT:8)`
 * @param getModuleSemesterTimetable getter to obtain the lesson indices of the module's lessons
 * @returns migrated semester timetable config
 */
export function deserializeTaModulesConfigV1(
  taSerialized: string | null | undefined,
  modules: ModulesMap,
  semester: number,
): SemTimetableConfig {
  if (!taSerialized || last(taSerialized) !== ')') {
    return {};
  }

  // CS2100(TUT:2,TUT:3,LAB:1),CS2107(TUT:8)
  const serializedTaModuleLessonConfigs = taSerialized.split(/(?<=\)),/);
  // ["CS2100(TUT:2,TUT:3,LAB:1)", "CS2107(TUT:8)"]
  return reduce(
    serializedTaModuleLessonConfigs,
    (accumulatedTaTimetableConfig, serializedTaModuleLessonConfig) => {
      // CS2100(TUT:2,TUT:3,LAB:1)
      const moduleConfig = serializedTaModuleLessonConfig.match(/(.*)\((.*)\)/);
      if (!moduleConfig || moduleConfig.length !== 3) {
        return accumulatedTaTimetableConfig;
      }
      const [, moduleCode, lessons] = moduleConfig;
      // ["CS2100", "TUT:2,TUT:3,LAB:1"]
      const module = get(modules, moduleCode);
      if (!module) return accumulatedTaTimetableConfig;

      const lessonMap = getModuleLessonMap(module, semester);
      if (!lessonMap) return accumulatedTaTimetableConfig;

      const moduleLessonConfig = lessons
        .split(LESSON_SEP)
        .reduce((accumulatedModuleLessonConfig, lesson) => {
          // TUT:2
          const [lessonTypeAbbr, classNo] = lesson.split(LESSON_TYPE_KEY_VALUE_SEP);
          // ["TUT", "2"]
          const lessonType = LESSON_ABBREV_TYPE[lessonTypeAbbr];
          if (!lessonType) return accumulatedModuleLessonConfig;

          const lessonsWithLessonType = toPairs(get(lessonMap, lessonType, {}));
          const lessonsWithClassNo = filter(
            lessonsWithLessonType,
            ([, lessonWithClassNo]) => lessonWithClassNo.classNo === classNo,
          );
          const classNoLessonKeys = map(lessonsWithClassNo, ([lessonKey]) => lessonKey);

          return {
            ...accumulatedModuleLessonConfig,
            [lessonType]: [
              ...(accumulatedModuleLessonConfig[lessonType] ?? []),
              ...classNoLessonKeys,
            ],
          } as ModuleLessonConfig;
        }, {} as ModuleLessonConfig);

      return {
        ...accumulatedTaTimetableConfig,
        [moduleCode]: moduleLessonConfig,
      } as SemTimetableConfig;
    },
    {} as SemTimetableConfig,
  );
}

/**
 * Deserializes a serialized v2 or v3 format lesson config string to a module lesson config

 * @param moduleLessonConfig moduleLessonConfig from previously parsed params to combine with, if any
 * @param serializedModuleLessonConfig e.g. `LEC:(0,1);TUT:(3)` (v2) `TODO` (v3)
 * @param timetable Array of valid lessons
 * @returns Combined moduleLessonConfig
 */
export function deserializeModuleLessonConfig(
  moduleLessonConfig: ModuleLessonConfig,
  serializedModuleLessonConfig: string,
  lessonMap: Readonly<LessonMap<RawLesson>>,
  timetable: readonly RawLesson[],
): ModuleLessonConfig {
  // LEC:(0,1);TUT:(3)
  return reduce(
    serializedModuleLessonConfig.split(LESSON_TYPE_SEP),
    (accumulatedModuleLessonConfig, lessonTypeSerialized) => {
      // LEC:(0,1)
      const [lessonTypeAbbr, serializedLessonTypeConfig] =
        lessonTypeSerialized.split(LESSON_TYPE_KEY_VALUE_SEP);
      const lessonType = LESSON_ABBREV_TYPE[lessonTypeAbbr];
      // ["LEC", "0,1"]
      const unwrappedLessonType = serializedLessonTypeConfig.match(/(?<=\()(.*)(?=\))/);
      if (!unwrappedLessonType) {
        return {
          ...accumulatedModuleLessonConfig,
          [lessonType]: [],
        };
      }
      const lessonTypeLessonKeys: LessonKey[] = map(
        unwrappedLessonType[0].split(LESSON_SEP),
        (lessonIdentifier) => {
          // parseInt coerces "1|..." to 1
          if (/^\d+$/.test(lessonIdentifier)) {
            const lessonIndex = parseInt(lessonIdentifier, 10);
            return serializeLessonDetails(timetable[lessonIndex]);
          }
          return lessonIdentifier;
        },
      ); // [0, 1]
      const validLessonKeys = keys(get(lessonMap, lessonType, {}));
      const validatedlessonTypeLessonKeys = filter(lessonTypeLessonKeys, (lessonTypeLessonKey) =>
        validLessonKeys.includes(lessonTypeLessonKey),
      );
      return {
        ...accumulatedModuleLessonConfig,
        [lessonType]: [
          ...(accumulatedModuleLessonConfig[lessonType] ?? []),
          ...validatedlessonTypeLessonKeys,
        ],
      };
    },
    moduleLessonConfig,
  );
}

/**
 * Deserializes a serialized v1 format lesson config to a module lesson config
 * @param moduleLessonConfig from previously parsed params, if any
 * @param serializedModuleLessonConfig e.g. `LEC:1,TUT:1,REC:1`
 * @param timetable Array of valid lessons
 * @returns Combined moduleLessonConfig
 */
export function deserializeModuleLessonConfigV1(
  moduleLessonConfig: ModuleLessonConfig,
  serializedModuleLessonConfig: string,
  lessonMap: Readonly<LessonMap<RawLesson>>,
): ModuleLessonConfig {
  // LEC:1,TUT:1,REC:1
  return reduce(
    serializedModuleLessonConfig.split(LESSON_SEP),
    (accumulatedModuleLessonConfig, lessonTypeSerialized) => {
      // LEC:1
      const [lessonTypeAbbr, classNo] = lessonTypeSerialized.split(LESSON_TYPE_KEY_VALUE_SEP);
      // ["LEC", "1"]
      const lessonType = LESSON_ABBREV_TYPE[lessonTypeAbbr];

      const lessonsWithLessonType = toPairs(get(lessonMap, lessonType, {}));
      const lessonsWithClassNo = filter(
        lessonsWithLessonType,
        ([, lesson]) => lesson.classNo === classNo,
      );
      const classNoLessonKeys = map(lessonsWithClassNo, ([lessonKey]) => lessonKey);

      return {
        ...accumulatedModuleLessonConfig,
        [lessonType]: [...(accumulatedModuleLessonConfig[lessonType] ?? []), ...classNoLessonKeys],
      };
    },
    moduleLessonConfig,
  );
}

/**
 * Deserializes hidden modules and TA modules config
 * @param serialized e.g. `CS3216,CS1010`
 * @returns `["CS3216", "CS1010"]`
 */
export function deserializeModuleCodes(serialized: string): ModuleCode[] {
  return serialized.split(LESSON_SEP);
}

function deserializeHiddenOrTaConfig(paramsKey: string, paramsValue: string | string[]) {
  const moduleCodes = reduce(
    castArray(paramsValue),
    (accumulatedModules, paramValue) => {
      // Skip if the ta param is a serialized with the v1 format
      if (paramsKey === 'ta' && last(paramValue) === ')') return accumulatedModules;

      return [...accumulatedModules, ...deserializeModuleCodes(paramValue)];
    },
    [] as ModuleCode[],
  );
  return moduleCodes;
}

interface DeserializationResult {
  semTimetableConfig: SemTimetableConfig;
  ta: ModuleCode[];
  hidden: ModuleCode[];
}

function parseModuleListParams(
  accumulatedDeserializationResult: DeserializationResult,
  paramsKey: 'hidden' | 'ta',
  paramsValue: string | string[] | null,
): DeserializationResult {
  if (!paramsValue) {
    return accumulatedDeserializationResult;
  }
  const moduleCodes = deserializeHiddenOrTaConfig(paramsKey, paramsValue);
  return {
    ...accumulatedDeserializationResult,
    [paramsKey]: [...accumulatedDeserializationResult[paramsKey], ...moduleCodes],
  };
}

function parseLessonConfigParams(
  accumulatedDeserializationResult: DeserializationResult,
  paramsKey: string,
  paramsValue: string | string[] | null,
  getTaModuleLessonConfig: (moduleCode: ModuleCode) => ModuleLessonConfig,
  modules: ModulesMap,
  semester: number,
): DeserializationResult {
  const moduleCode = paramsKey;

  const module = get(modules, moduleCode, undefined);
  if (!module) return accumulatedDeserializationResult;

  if (!paramsValue) {
    return {
      ...accumulatedDeserializationResult,
      semTimetableConfig: {
        ...accumulatedDeserializationResult.semTimetableConfig,
        [moduleCode]: {},
      },
    };
  }

  const lessonMap = getModuleLessonMap(module, semester);
  const timetable = getModuleTimetable(module, semester);
  const moduleLessonConfig = reduce(
    castArray(paramsValue),
    (accumulatedModuleLessonConfig, serializedModuleLessonConfig) => {
      // If using the lesson group serialization (v2) or the lesson details serialization (v3)
      // paramsKey = CS2103T
      // paramsValue = LEC:(0,1);TUT:(3)
      if (
        serializedModuleLessonConfig &&
        serializedModuleLessonConfig[serializedModuleLessonConfig.length - 1] === ')'
      )
        return deserializeModuleLessonConfig(
          accumulatedModuleLessonConfig,
          serializedModuleLessonConfig,
          lessonMap,
          timetable,
        );

      // TA module lesson config overrides the non-TA module lesson config
      const taModuleLessonConfig = getTaModuleLessonConfig(moduleCode);
      if (taModuleLessonConfig) return taModuleLessonConfig;

      // If using the v1 format serialization
      // paramsKey = CS2103T
      // paramsValue = LEC:0,TUT:3
      return deserializeModuleLessonConfigV1(
        accumulatedModuleLessonConfig,
        serializedModuleLessonConfig,
        lessonMap,
      );
    },
    {} as ModuleLessonConfig,
  );
  return {
    ...accumulatedDeserializationResult,
    semTimetableConfig: {
      ...accumulatedDeserializationResult.semTimetableConfig,
      [moduleCode]: moduleLessonConfig,
    },
  };
}

/**
 * Entry point to deserialize a serialized timetable string\
 * Checks serialization format and parses accordingly
 * - V1 format: `?CS1010S=LEC:1,TUT:1,REC:1&ta=CS1010S(LEC:1,TUT:1,TUT:2,REC:1)&hidden=CS1010S`
 * - V2 format: `?CS1010S=LEC:(0);TUT:(11,22);REC:(1)&ta=CS1010S&hidden=CS1010S`
 * - V3 format: `?CS1010S=LEC:(1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13);TUT:(1|MON|0900|1000|COM1-0203|3_4_5_6_7_8_9_10_11_12_13,2|MON|1000|1100|COM1-0217|3_4_5_6_7_8_9_10_11_12_13;REC:(1|THU|1200|1300|S14-0619|1_2_3_4_5_6_7_8_9_10_11_12_13)&ta=CS1010S&hidden=CS1010S`
 * @param serialized
 * @param getModuleSemesterTimetable
 * @returns
 */
export function deserializeTimetable(
  serialized: string,
  modules: ModulesMap,
  semester: number,
): {
  semTimetableConfig: SemTimetableConfig;
  ta: ModuleCode[];
  hidden: ModuleCode[];
} {
  const params = qs.parse(serialized);
  const taParams = isArray(params.ta) ? last(params.ta) : params.ta;
  // If TA modules were serialized using the v1 format
  // we deserialize it first so we can skip deserializing the module code down the line
  // because TA module lesson config overrides the non-TA module lesson config
  const taModuleLessonConfigs = deserializeTaModulesConfigV1(taParams, modules, semester);
  const getTaModuleLessonConfig = (moduleCode: ModuleCode): ModuleLessonConfig =>
    get(taModuleLessonConfigs, moduleCode);

  return reduce(
    params,
    (accumulatedDeserializationResult, paramsValue, paramsKey) => {
      switch (paramsKey) {
        case 'hidden':
        case 'ta': {
          return parseModuleListParams(accumulatedDeserializationResult, paramsKey, paramsValue);
        }

        default: {
          return parseLessonConfigParams(
            accumulatedDeserializationResult,
            paramsKey,
            paramsValue,
            getTaModuleLessonConfig,
            modules,
            semester,
          );
        }
      }
    },
    {
      semTimetableConfig: {},
      ta: keys(taModuleLessonConfigs),
      hidden: [],
    } as DeserializationResult,
  );
}

export function isSameLesson(l1: Lesson, l2: Lesson) {
  return (
    l1.lessonType === l2.lessonType &&
    l1.classNo === l2.classNo &&
    l1.moduleCode === l2.moduleCode &&
    l1.startTime === l2.startTime &&
    l1.endTime === l2.endTime &&
    l1.day === l2.day &&
    isEqual(l1.weeks, l2.weeks)
  );
}

export function getHoverLesson(lesson: InteractableLesson): HoverLesson {
  return {
    classNo: lesson.classNo,
    moduleCode: lesson.moduleCode,
    lessonType: lesson.lessonType,
    lessonKey: lesson.lessonKey,
  };
}

/**
 * Differentiates between ColoredLesson and InteractableLesson
 * @param lesson Must be a ColoredLesson or InteractableLesson
 */
export function isInteractable(
  lesson: ColoredLesson | InteractableLesson,
): lesson is InteractableLesson {
  return 'canBeSelectedAsActiveLesson' in lesson;
}

/**
 * Obtain a semi-unique key for a lesson
 */
export function getLessonIdentifier(lesson: Lesson): string {
  return `${lesson.moduleCode}-${LESSON_TYPE_ABBREV[lesson.lessonType]}-${lesson.classNo}`;
}

export function isV1(config: ClassNo | LessonIndex[] | LessonKey[]): config is ClassNo {
  return !isArray(config);
}

type LessonIndex = number;
export function isV2(config: LessonIndex[] | LessonKey[]): config is LessonIndex[] {
  return isNumber(get(config, 0, undefined));
}

/**
 * A helper function for migrateSemTimetableConfig\
 * Migrates a module's lesson config
 * @param moduleLessonConfig the module lesson config to migrate
 * @param taModulesConfig the TA lesson configs overrides the semester timetable config
 * @param moduleCode
 * @returns
 * - the migrated config
 * - whether it was previously migrated, to signal to skip dispatch
 */
export function migrateModuleLessonConfig(
  moduleLessonConfig: ModuleLessonConfig | ModuleLessonConfigV1,
  taModulesConfig: ModuleCode[] | TaModulesConfigV1,
  moduleCode: ModuleCode,
  timetable: readonly RawLesson[],
  lessonMap: Readonly<LessonMap<RawLesson>>,
): {
  migratedModuleLessonConfig: ModuleLessonConfig;
  alreadyMigrated: boolean;
} {
  return reduce(
    moduleLessonConfig,
    (accumulatedModuleLessonConfig, lessonsIdentifier, lessonType) => {
      if (!isV1(lessonsIdentifier)) {
        const configIsV2 = isV2(lessonsIdentifier);
        const migratedLessonConfig = configIsV2
          ? map(lessonsIdentifier, (lessonIndex) => serializeLessonDetails(timetable[lessonIndex]))
          : lessonsIdentifier;

        return {
          ...accumulatedModuleLessonConfig,
          migratedModuleLessonConfig: {
            ...accumulatedModuleLessonConfig.migratedModuleLessonConfig,
            [lessonType]: migratedLessonConfig,
          },
          alreadyMigrated: !configIsV2,
        };
      }

      const taClassNos = isArray(taModulesConfig)
        ? []
        : filter(
            taModulesConfig[moduleCode],
            (lessonTypeConfig) => lessonTypeConfig[0] === lessonType,
          );
      const classNos: ClassNo[] = taClassNos.length ? map(taClassNos, '1') : [lessonsIdentifier];
      const lessonKeys: LessonType[] = keys(
        pickBy(lessonMap[lessonType], (lesson) => classNos.includes(lesson.classNo)),
      );

      return {
        migratedModuleLessonConfig: {
          ...accumulatedModuleLessonConfig.migratedModuleLessonConfig,
          [lessonType]: lessonKeys,
        },
        alreadyMigrated: false,
      };
    },
    {
      migratedModuleLessonConfig: {},
      alreadyMigrated: true,
    } as {
      migratedModuleLessonConfig: ModuleLessonConfig;
      alreadyMigrated: boolean;
    },
  );
}

/**
 * Migrates a semester's timetable config
 * @param semTimetableConfig the semester timetable config to migrate
 * @param taModulesConfig the TA lesson configs overrides the semester timetable config
 * @param modules the modules in the moduleBank, used to find lesson indices of the classNo
 * @param semester the semester of the timetable to migrate, used to find lesson indices of the classNo
 * @returns
 * - the migrated semester timetable config
 * - the migrated semester ta config
 * - whether it was previously migrated, to signal to skip dispatch
 */
export function migrateSemTimetableConfig(
  semTimetableConfig: SemTimetableConfig | SemTimetableConfigV1,
  taModulesConfig: ModuleCode[] | TaModulesConfigV1,
  modules: ModulesMap,
  semester: Semester,
): {
  migratedSemTimetableConfig: SemTimetableConfig;
  migratedTaModulesConfig: ModuleCode[];
  alreadyMigrated: boolean;
} {
  return reduce(
    semTimetableConfig,
    (accumulatedSemTimetableConfig, moduleLessonConfig, moduleCode) => {
      const isTa = isArray(taModulesConfig)
        ? taModulesConfig.includes(moduleCode)
        : moduleCode in taModulesConfig;

      const module = get(modules, moduleCode, undefined);
      if (!module) return accumulatedSemTimetableConfig;

      const timetable = getModuleTimetable(module, semester);

      const lessonMap = getModuleLessonMap(modules[moduleCode], semester);
      const { migratedModuleLessonConfig, alreadyMigrated } = migrateModuleLessonConfig(
        moduleLessonConfig,
        taModulesConfig,
        moduleCode,
        timetable,
        lessonMap,
      );

      return {
        migratedSemTimetableConfig: {
          ...accumulatedSemTimetableConfig.migratedSemTimetableConfig,
          [moduleCode]: migratedModuleLessonConfig,
        },
        migratedTaModulesConfig: isTa
          ? [...accumulatedSemTimetableConfig.migratedTaModulesConfig, moduleCode]
          : accumulatedSemTimetableConfig.migratedTaModulesConfig,
        alreadyMigrated: accumulatedSemTimetableConfig.alreadyMigrated && alreadyMigrated,
      };
    },
    {
      migratedSemTimetableConfig: {},
      migratedTaModulesConfig: [],
      alreadyMigrated: true,
    } as {
      migratedSemTimetableConfig: SemTimetableConfig;
      migratedTaModulesConfig: ModuleCode[];
      alreadyMigrated: boolean;
    },
  );
}

function getClosestLessonTypeLessons(
  validLessons: Record<LessonKey, RawLesson>,
  configLessonKeys: LessonKey[],
): Record<LessonKey, RawLesson> {
  const configLessonsByClassNo = groupBy(
    map(configLessonKeys, deserializeLessonDetails),
    'classNo',
  );
  const closestLessons = maxBy(
    toPairs(configLessonsByClassNo),
    ([, lessonsWithClassNo]) => lessonsWithClassNo.length,
  );

  if (!closestLessons) return getRecoveryLessons(validLessons);

  const [closestClassNo] = closestLessons;
  const lessonKeys = pickBy(validLessons, (lesson) => lesson.classNo === closestClassNo);

  return lessonKeys;
}

/**
 * Based on what lessons are currently in the lesson config, find the classNo that most of the lessons belong to
 * @param serializedLessonDetailsMap {@link SerializedLessonDetailsMap|Lesson indices mapping} of the module
 * @param timetableSerializedLessonDetails lessons currently in lesson config
 * @returns a lesson config consisting of lesson indices that best matches the TA lesson config
 */
export function getClosestLessonConfig(
  lessonMap: LessonMap<RawLesson>,
  timetableLessonKeys: ModuleLessonConfig,
): ModuleLessonConfig {
  return reduce(
    lessonMap,
    (accumulatedModuleLessonConfig, moduleLessonsWithLessonType, lessonType) => {
      const timetableLessonsWithLessonType: LessonKey[] = timetableLessonKeys[lessonType];
      const { lessonKeys } = getClosestLessonTypeLessons(
        moduleLessonsWithLessonType,
        timetableLessonsWithLessonType,
      );

      return {
        ...accumulatedModuleLessonConfig,
        [lessonType]: keys(lessonKeys),
      };
    },
    {} as ModuleLessonConfig,
  );
}

export function serializeWeekNumbers(weeks: readonly Number[]) {
  return weeks.join('_');
}

export function serializeWeekRange({ start, end, weekInterval, weeks }: WeekRange) {
  const serializedStartEndInterval = [start, end, weekInterval ?? 1].join('_');
  if (!weeks) return serializedStartEndInterval;
  return `${serializedStartEndInterval}_${serializeWeekNumbers(weeks)}`;
}

export function serializeLessonDetails<T extends RawLesson>(lesson: T): string {
  const { classNo, day, startTime, endTime, venue, weeks } = lesson;

  const abbreviatedDayOfWeek = DAY_OF_WEEK_ABBREV[day as DayOfWeek];
  const serializedWeeks = isWeekRange(weeks)
    ? serializeWeekRange(weeks)
    : `${serializeWeekNumbers(weeks)}`;

  return [classNo, abbreviatedDayOfWeek, startTime, endTime, venue, serializedWeeks].join('|');
}

function parseWeeks(serializedWeeks: string): Weeks {
  if (/-/.test(serializedWeeks)) {
    const parsedRegex =
      /(?<start>[\-0-9]*)_(?<end>[\-0-9]*)_(?<weekInterval>[0-9])_?((?:_*[0-9])*)/.exec(
        serializedWeeks,
      );
    const regexGroup = parsedRegex?.groups;
    if (!regexGroup) return [];

    const start = get(regexGroup, 'start');
    const end = get(regexGroup, 'end');
    const weekInterval = get(regexGroup, 'weekInterval');
    const weeks = get(regexGroup, 'weeks') ?? [];

    if (isUndefined(start) || isUndefined(end) || isUndefined(weekInterval)) return [];

    return {
      start,
      end,
      weekInterval: parseInt(weekInterval, 10),
      weeks: map(weeks, (week) => parseInt(week, 10)),
    };
  }

  return map(serializedWeeks.split('_'), (week) => parseInt(week, 10));
}

export function deserializeLessonDetails(
  serializedLessonDetails: string,
): Omit<RawLesson, 'lessonType'> {
  const [classNo, abbreviatedDayOfWeek, startTime, endTime, venue, serializedWeeks] =
    serializedLessonDetails.split('|');

  return {
    classNo,
    day: DAY_OF_WEEK_FULL[abbreviatedDayOfWeek],
    startTime,
    endTime,
    venue,
    weeks: parseWeeks(serializedWeeks),
  };
}

/**
 * Hydrate timetable lessons with interactability info\
 * See type defintion of `InteractableLesson` for properties added
 */
export function getInteractableLessons(
  timetableLessons: SemTimetableConfigWithLessons<Lesson & ValidationResult>,
  taModules: ModuleCode[],
  modules: ModulesMap,
  semester: Semester,
  colors: ColorMapping,
  readOnly: boolean,
  activeLesson: Lesson | null,
): SemTimetableConfigWithLessons<InteractableLesson> {
  const moduleTimetables = mapValues(modules, (module) => getModuleTimetable(module, semester));
  const activeLessonKey = activeLesson ? serializeLessonDetails(activeLesson) : null;

  return mapValues(
    timetableLessons,
    (lessonMap: LessonMap<Lesson & ValidationResult>, moduleCode: ModuleCode) => {
      const isTaInTimetable = taModules.includes(moduleCode);

      return mapValues(
        lessonMap,
        (
          lessonsWithLessonType,
          lessonType: LessonType,
        ): { [lessonKey: LessonKey]: InteractableLesson } => {
          const isSameModuleAndLessonType =
            moduleCode === activeLesson?.moduleCode && lessonType === activeLesson?.lessonType;

          const configLessonKeys: LessonKey[] = keys(lessonsWithLessonType);
          const lessons =
            activeLesson && isSameModuleAndLessonType
              ? mapValues(
                  getModuleLessonMap(modules[moduleCode], semester)[lessonType],
                  (lesson) => ({ ...lesson, valid: true }),
                )
              : lessonsWithLessonType;

          return mapValues(lessons, (lesson, lessonKey: LessonKey): InteractableLesson => {
            const isActive = isSameModuleAndLessonType && lessonKey === activeLessonKey;
            const canBeSelectedAsActiveLesson =
              !readOnly &&
              (isTaInTimetable ||
                areOtherClassesAvailable(moduleTimetables[moduleCode], lessonType));

            const alreadyAddedToLessonConfig = configLessonKeys.includes(lessonKey);
            const isSameLessonGroupAsActiveLesson = isTaInTimetable
              ? isActive
              : lesson.classNo === activeLesson?.classNo;
            const canBeAddedToLessonConfig =
              isSameModuleAndLessonType &&
              !alreadyAddedToLessonConfig &&
              !isSameLessonGroupAsActiveLesson;

            return {
              ...lesson,
              moduleCode,
              title: modules[moduleCode].title,
              isActive,
              isTaInTimetable,
              canBeAddedToLessonConfig,
              canBeSelectedAsActiveLesson,
              colorIndex: colors[moduleCode],
              lessonKey,
            };
          });
        },
      );
    },
  );
}
