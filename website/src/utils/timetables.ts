import { AcadWeekInfo } from 'nusmoderator';
import {
  castArray,
  entries,
  filter,
  first,
  flatMapDeep,
  get,
  groupBy,
  intersection,
  invert,
  isArray,
  isEmpty,
  isEqual,
  isNumber,
  keys,
  last,
  map,
  mapValues,
  maxBy,
  partition,
  pick,
  range,
  reduce,
  sample,
  some,
  values,
} from 'lodash';
import { addDays, min as minDate, parseISO, startOfDay } from 'date-fns';
import qs from 'query-string';

import {
  consumeWeeks,
  SerializedLessonDetails,
  LessonType,
  RawLessonWithSerializedDetails,
  Module,
  ModuleCode,
  NumericWeeks,
  RawLesson,
  Semester,
  ClassNo,
  SerializedLessonDetailsMap,
} from 'types/modules';

import {
  ModuleLessonConfigV1,
  SemTimetableConfigV1,
  TaModulesConfigV1,
  ColoredLesson,
  HoverLesson,
  InteractableLesson,
  Lesson,
  LessonWithSerializedDetails,
  ModuleLessonConfig,
  ModuleLessonConfigWithLessons,
  SemTimetableConfig,
  SemTimetableConfigWithLessons,
  TimetableDayArrangement,
  TimetableDayFormat,
  TimetableArrangement,
} from 'types/timetables';

import { ModuleCodeMap, ModulesMap } from 'types/reducers';
import { ExamClashes } from 'types/views';

import { getTimeAsDate } from './timify';
import { getModuleTimetable, getExamDate, getExamDuration } from './modules';
import { deltas } from './array';

type lessonTypeAbbrev = { [lessonType: string]: string };
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

  const lessonByGroups: { [lessonType: string]: readonly RawLessonWithSerializedDetails[] } =
    groupBy(lessonsWithSerializedDetails, (lesson) => lesson.lessonType);

  const lessonByGroupsByClassNo: {
    [lessonType: string]: { [classNo: string]: readonly RawLessonWithSerializedDetails[] };
  } = mapValues(
    lessonByGroups,
    (lessonsOfSamelessonType: readonly RawLessonWithSerializedDetails[]) =>
      groupBy(lessonsOfSamelessonType, (lesson) => lesson.classNo),
  );

  return mapValues(
    lessonByGroupsByClassNo,
    (group: { [classNo: string]: readonly RawLessonWithSerializedDetails[] }) => {
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
): SemTimetableConfigWithLessons {
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
): ModuleLessonConfigWithLessons {
  return mapValues(moduleLessonConfig, (serializedLessonDetails: SerializedLessonDetails[]) => {
    const lessons = getModuleTimetable(module, semester);
    const lessonsWithSerializedDetails = map(lessons, (lesson) => ({
      ...lesson,
      serializedLessonDetails: serializeLessonDetails(lesson),
    }));
    const newLessons = lessonsWithSerializedDetails.filter(
      (lesson: RawLessonWithSerializedDetails) =>
        serializedLessonDetails.includes(lesson.serializedLessonDetails),
    );
    return newLessons.map((lesson: RawLessonWithSerializedDetails) => ({
      ...lesson,
      moduleCode: module.moduleCode,
      title: module.title,
    }));
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
export function timetableLessonsArray(
  timetable: SemTimetableConfigWithLessons,
): LessonWithSerializedDetails[] {
  return flatMapDeep(timetable, values);
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
  return consumeWeeks(
    lesson.weeks,
    (weeks) => weeks.includes(weekInfo.num as number),
    (weekRange) => {
      const end = minDate([parseISO(weekRange.end), date]);
      for (let current = parseISO(weekRange.start); current <= end; current = addDays(current, 7)) {
        if (isEqual(current, startOfDay(date))) return true;
      }

      return false;
    },
  );
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
 * @param validLessons {@link RawLessonWithSerializedDetails|lesson}s to validate against
 * @returns
 * - validated TA modules' {@link ModuleLessonConfig|lesson config}
 * - whether the input is valid, to signal to skip dispatch
 */
export function validateTaModuleLessons(
  lessonConfig: ModuleLessonConfig,
  validLessons: readonly RawLessonWithSerializedDetails[],
): {
  validatedLessonConfig: ModuleLessonConfig;
  valid: boolean;
} {
  const lessonsByType = groupBy(validLessons, (lesson) => lesson.lessonType);
  const { config: validatedLessonConfig, valid } = reduce(
    lessonConfig,
    (accumulatedValidationResult, configSerializedLessonDetails, lessonType) => {
      const validSerializedLessonDetails = map(
        lessonsByType[lessonType],
        'serializedLessonDetails',
      );
      if (!validSerializedLessonDetails.length) {
        return {
          config: accumulatedValidationResult.config,
          valid: false,
        };
      }
      const hasInvalidLesson = some(
        configSerializedLessonDetails,
        (serializedLessonDetails) =>
          !validSerializedLessonDetails.includes(serializedLessonDetails),
      );
      return {
        config: {
          ...accumulatedValidationResult.config,
          [lessonType]: hasInvalidLesson
            ? getRecoverySerializedLessonDetails(lessonsByType[lessonType])
            : configSerializedLessonDetails,
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
 * @param lessonsWithLessonType lessons with the same lesson type to generate a valid lesson config from
 * @returns lesson indices of the generated valid lesson config
 *
 * Note: the current implementation generates a config containing lessons belonging to the first classNo in the provided lessons
 */
export function getRecoverySerializedLessonDetails(
  lessonsWithLessonType: RawLessonWithSerializedDetails[],
): SerializedLessonDetails[] {
  const firstClass = first(lessonsWithLessonType);
  if (!firstClass) {
    return [];
  }
  const { classNo } = firstClass;
  const validSerializedLessonDetails = map(
    filter(lessonsWithLessonType, (lesson) => lesson.classNo === classNo),
    'serializedLessonDetails',
  );
  return validSerializedLessonDetails;
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
  validLessons: readonly RawLessonWithSerializedDetails[],
): {
  validatedLessonConfig: ModuleLessonConfig;
  valid: boolean;
} {
  const lessonsByType = groupBy(validLessons, (lesson) => lesson.lessonType);
  const lessonTypesInLessonConfig = keys(lessonConfig);
  const { config: validatedLessonConfig, valid: configValid } = reduce(
    lessonsByType,
    (accumulatedValidationResult, lessonsWithLessonType, lessonType) => {
      const lessonTypeInLessonConfig = lessonTypesInLessonConfig.includes(lessonType);
      const configSerializedLessonDetails = lessonConfig[lessonType];
      const firstSerializedLessonDetails = first(configSerializedLessonDetails);

      if (
        !(
          lessonTypeInLessonConfig &&
          configSerializedLessonDetails.length &&
          isNumber(firstSerializedLessonDetails) &&
          firstSerializedLessonDetails < validLessons.length
        )
      ) {
        const validSerializedLessonDetails =
          getRecoverySerializedLessonDetails(lessonsWithLessonType);
        return {
          config: {
            ...accumulatedValidationResult.config,
            [lessonType]: validSerializedLessonDetails,
          },
          valid: false,
        };
      }

      const firstLesson = get(validLessons, firstSerializedLessonDetails);
      const { classNo } = firstLesson;
      const classNoSerializedLessonDetails = map(
        filter(lessonsWithLessonType, (lesson) => lesson.classNo === classNo),
        'serializedLessonDetails',
      );
      const configSerializedLessonDetailsValid = isEqual(
        new Set(configSerializedLessonDetails),
        new Set(classNoSerializedLessonDetails),
      );
      const validSerializedLessonDetails = configSerializedLessonDetailsValid
        ? classNoSerializedLessonDetails
        : getRecoverySerializedLessonDetails(lessonsWithLessonType);

      return {
        config: {
          ...accumulatedValidationResult.config,
          [lessonType]: validSerializedLessonDetails,
        },
        valid: accumulatedValidationResult.valid && configSerializedLessonDetailsValid,
      };
    },
    { config: {}, valid: true } as { config: ModuleLessonConfig; valid: boolean },
  );

  const configLessonTypesValid = isEqual(
    new Set(keys(validatedLessonConfig)),
    new Set(lessonTypesInLessonConfig),
  );

  return {
    validatedLessonConfig,
    valid: configValid && configLessonTypesValid,
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
): { validatedLessonConfig: ModuleLessonConfig; valid: boolean } {
  const validLessons = getModuleTimetable(module, semester);

  if (isTa) {
    return validateTaModuleLessons(lessonConfig, validLessons);
  }

  return validateNonTaModuleLesson(lessonConfig, validLessons);
}

/**
 * Group lessons by lesson types then classNo
 * @param lessonsWithIndex lessons to group
 * @returns lesson indices, not lessons
 */
export const makeSerializedLessonDetailsMap = (
  lessonsWithIndex: readonly RawLessonWithSerializedDetails[],
): SerializedLessonDetailsMap => {
  const lessonsByLessonType = groupBy(lessonsWithIndex, 'lessonType');
  return mapValues(lessonsByLessonType, (lessonsWithLessonType) => {
    const lessonsByClassNo = groupBy(lessonsWithLessonType, 'classNo');
    return mapValues(lessonsByClassNo, (lessonsWithClassNo) =>
      map(lessonsWithClassNo, 'serializedLessonDetails'),
    );
  });
};

/**
 * Helper function to return the indices of lessons belonging to the {@link LessonType|lesson type} and {@link ClassNo|classNo} in the {@link SerializedLessonDetailsMap|lesson index mapping}
 * @param serializedLessonDetailsMap
 * @param lessonType
 * @param classNo
 */
const getSerializedLessonDetails = (
  serializedLessonDetailsMap: SerializedLessonDetailsMap,
  lessonType: LessonType,
  classNo: ClassNo,
): SerializedLessonDetails[] => get(get(serializedLessonDetailsMap, lessonType), classNo);

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
  getModuleSemesterTimetable: (moduleCode: ModuleCode) => readonly RawLessonWithSerializedDetails[],
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
      const timetable = getModuleSemesterTimetable(moduleCode);
      if (!timetable) return accumulatedTaTimetableConfig;
      const serializedLessonDetailsMap = makeSerializedLessonDetailsMap(timetable);

      const moduleLessonConfig = lessons
        .split(LESSON_SEP)
        .reduce((accumulatedModuleLessonConfig, lesson) => {
          // TUT:2
          const [lessonTypeAbbr, classNo] = lesson.split(LESSON_TYPE_KEY_VALUE_SEP);
          // ["TUT", "2"]
          const lessonType = LESSON_ABBREV_TYPE[lessonTypeAbbr];
          if (!lessonType) return accumulatedModuleLessonConfig;
          const serializedLessonDetails = getSerializedLessonDetails(
            serializedLessonDetailsMap,
            lessonType,
            classNo,
          );
          return {
            ...accumulatedModuleLessonConfig,
            [lessonType]: [
              ...(accumulatedModuleLessonConfig[lessonType] ?? []),
              ...(serializedLessonDetails ?? []),
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
 * Deserializes a serialized v2 format lesson config string to a module lesson config

 * @param moduleLessonConfig moduleLessonConfig from previously parsed params to combine with, if any
 * @param serializedModuleLessonConfig e.g. `LEC:(0,1);TUT:(3)`
 * @param timetable Array of valid lessons
 * @returns Combined moduleLessonConfig
 */
export function deserializeModuleLessonConfig(
  moduleLessonConfig: ModuleLessonConfig,
  serializedModuleLessonConfig: string,
  timetable: readonly RawLessonWithSerializedDetails[],
): ModuleLessonConfig {
  const lessonsByLessonType = groupBy(timetable, 'lessonType');
  // LEC:(0,1);TUT:(3)
  return reduce(
    serializedModuleLessonConfig.split(LESSON_TYPE_SEP),
    (accumulatedModuleLessonConfig, lessonTypeSerialized) => {
      // LEC:(0,1)
      const [lessonTypeAbbr, serializedLessonDetailsSerialized] =
        lessonTypeSerialized.split(LESSON_TYPE_KEY_VALUE_SEP);
      // ["LEC", "0,1"]
      const unwrappedSerializedLessonDetailsSerialized =
        serializedLessonDetailsSerialized.match(/(?<=\()(.*)(?=\))/);
      if (!unwrappedSerializedLessonDetailsSerialized) {
        return accumulatedModuleLessonConfig;
      }
      const serializedLessonDetails =
        unwrappedSerializedLessonDetailsSerialized[0].split(LESSON_SEP); // [0, 1]
      const lessonType = LESSON_ABBREV_TYPE[lessonTypeAbbr];
      const validSerializedLessonDetails = map(
        lessonsByLessonType[lessonType],
        'serializedLessonDetails',
      );
      const validatedSerializedLessonDetails = filter(
        serializedLessonDetails,
        (serializedLessonDetails) => validSerializedLessonDetails.includes(serializedLessonDetails),
      );
      return {
        ...accumulatedModuleLessonConfig,
        [lessonType]: [
          ...(accumulatedModuleLessonConfig[lessonType] ?? []),
          ...validatedSerializedLessonDetails,
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
  timetable: readonly RawLessonWithSerializedDetails[],
): ModuleLessonConfig {
  // LEC:1,TUT:1,REC:1
  const serializedLessonDetailsMap = makeSerializedLessonDetailsMap(timetable);
  return reduce(
    serializedModuleLessonConfig.split(LESSON_SEP),
    (accumulatedModuleLessonConfig, lessonTypeSerialized) => {
      // LEC:1
      const [lessonTypeAbbr, classNo] = lessonTypeSerialized.split(LESSON_TYPE_KEY_VALUE_SEP);
      // ["LEC", "1"]
      const lessonType = LESSON_ABBREV_TYPE[lessonTypeAbbr];
      const serializedLessonDetails = getSerializedLessonDetails(
        serializedLessonDetailsMap,
        lessonType,
        classNo,
      );
      return {
        ...accumulatedModuleLessonConfig,
        [lessonType]: [
          ...(accumulatedModuleLessonConfig[lessonType] ?? []),
          ...(serializedLessonDetails ?? []),
        ],
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
  getModuleSemesterTimetable: (moduleCode: ModuleCode) => readonly RawLessonWithSerializedDetails[],
  getTaModuleLessonConfig: (moduleCode: ModuleCode) => ModuleLessonConfig,
): DeserializationResult {
  const moduleCode = paramsKey;
  if (!paramsValue) {
    return {
      ...accumulatedDeserializationResult,
      semTimetableConfig: {
        ...accumulatedDeserializationResult.semTimetableConfig,
        [moduleCode]: {},
      },
    };
  }
  const timetable = getModuleSemesterTimetable(moduleCode);
  const moduleLessonConfig = reduce(
    castArray(paramsValue),
    (accumulatedModuleLessonConfig, serializedModuleLessonConfig) => {
      // If using the lesson group serialization (v2)
      // paramsKey = CS2103T
      // paramsValue = LEC:(0,1);TUT:(3)
      if (
        serializedModuleLessonConfig &&
        serializedModuleLessonConfig[serializedModuleLessonConfig.length - 1] === ')'
      )
        return deserializeModuleLessonConfig(
          accumulatedModuleLessonConfig,
          serializedModuleLessonConfig,
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
        timetable,
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
 * - V3 format: `?CS1010S=LEC|1|WED|1200|1400|LT32,`
 * @param serialized
 * @param getModuleSemesterTimetable
 * @returns
 */
export function deserializeTimetable(
  serialized: string,
  getModuleSemesterTimetable: (moduleCode: ModuleCode) => readonly RawLessonWithSerializedDetails[],
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
  const taModuleLessonConfigs = deserializeTaModulesConfigV1(taParams, getModuleSemesterTimetable);
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
            getModuleSemesterTimetable,
            getTaModuleLessonConfig,
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

/**
 * A helper function to convert the lesson indices array in a semester timetable config to sets
 */
function convertSemTimetableConfigSerializedLessonDetailsFromArrayToSets(
  semTimetableConfig: SemTimetableConfig,
): {
  [lessonType: LessonType]: {
    [classNo: ClassNo]: Set<SerializedLessonDetails>;
  };
} {
  return mapValues(semTimetableConfig, (moduleLessonConfig) =>
    mapValues(moduleLessonConfig, (lessonsInLessonType) => new Set(lessonsInLessonType)),
  );
}

export function isSameTimetableConfig(t1: SemTimetableConfig, t2: SemTimetableConfig): boolean {
  return isEqual(
    convertSemTimetableConfigSerializedLessonDetailsFromArrayToSets(t1),
    convertSemTimetableConfigSerializedLessonDetailsFromArrayToSets(t2),
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
    serializedLessonDetails: lesson.serializedLessonDetails,
  };
}

/**
 * Differentiates between ColoredLesson and InteractableLesson
 * @param lesson Must be a ColoredLesson or InteractableLesson
 */
export function isInteractable(
  lesson: ColoredLesson | InteractableLesson,
): lesson is InteractableLesson {
  return 'serializedLessonDetails' in lesson;
}

/**
 * Obtain a semi-unique key for a lesson
 */
export function getLessonIdentifier(lesson: Lesson): string {
  return `${lesson.moduleCode}-${LESSON_TYPE_ABBREV[lesson.lessonType]}-${lesson.classNo}`;
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
  timetable: readonly RawLessonWithSerializedDetails[],
): {
  migratedModuleLessonConfig: ModuleLessonConfig;
  alreadyMigrated: boolean;
} {
  const serializedLessonDetailsMap = makeSerializedLessonDetailsMap(timetable);
  return reduce(
    moduleLessonConfig,
    (accumulatedModuleLessonConfig, lessonsIdentifier, lessonType) => {
      if (isArray(lessonsIdentifier)) {
        return {
          ...accumulatedModuleLessonConfig,
          migratedModuleLessonConfig: {
            ...accumulatedModuleLessonConfig.migratedModuleLessonConfig,
            [lessonType]: lessonsIdentifier,
          },
        };
      }

      const taClassNos = isArray(taModulesConfig)
        ? []
        : filter(
            taModulesConfig[moduleCode],
            (lessonTypeConfig) => lessonTypeConfig[0] === lessonType,
          );
      const classNos = taClassNos.length ? map(taClassNos, '1') : [lessonsIdentifier];

      const serializedLessonDetails = reduce(
        classNos,
        (accumulatedSerializedLessonDetails, classNo) => {
          const serializedLessonDetailsWithClassNo = getSerializedLessonDetails(
            serializedLessonDetailsMap,
            lessonType,
            classNo,
          ) as (SerializedLessonDetails | undefined)[];
          if (
            !serializedLessonDetailsWithClassNo ||
            serializedLessonDetailsWithClassNo.includes(undefined)
          ) {
            throw new Error('Lesson indices missing');
          }
          return [
            ...accumulatedSerializedLessonDetails,
            ...(serializedLessonDetailsWithClassNo as SerializedLessonDetails[]),
          ];
        },
        [] as SerializedLessonDetails[],
      );

      return {
        migratedModuleLessonConfig: {
          ...accumulatedModuleLessonConfig.migratedModuleLessonConfig,
          [lessonType]: serializedLessonDetails,
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
  getModuleSemesterTimetable: (moduleCode: ModuleCode) => readonly RawLessonWithSerializedDetails[],
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

      const timetable = getModuleSemesterTimetable(moduleCode);
      const { migratedModuleLessonConfig, alreadyMigrated } = migrateModuleLessonConfig(
        moduleLessonConfig,
        taModulesConfig,
        moduleCode,
        timetable,
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

/**
 * Based on what lessons are currently in the lesson config, find the classNo that most of the lessons belong to
 * @param serializedLessonDetailsMap {@link SerializedLessonDetailsMap|Lesson indices mapping} of the module
 * @param timetableSerializedLessonDetails lessons currently in lesson config
 * @returns a lesson config consisting of lesson indices that best matches the TA lesson config
 */
export function getClosestLessonConfig(
  serializedLessonDetailsMap: SerializedLessonDetailsMap,
  timetableSerializedLessonDetails: ModuleLessonConfig,
): ModuleLessonConfig {
  return reduce(
    serializedLessonDetailsMap,
    (accumulatedModuleLessonConfig, lessonsWithLessonType, lessonType) => {
      const timetableLessonsWithLessonType = timetableSerializedLessonDetails[lessonType];
      const lessonGroupOccurrences = entries(
        reduce(
          lessonsWithLessonType,
          (accumulated, serializedLessonDetails, lessonGroup) => ({
            ...accumulated,
            [lessonGroup]: intersection(serializedLessonDetails, timetableLessonsWithLessonType)
              .length,
          }),
          {} as Record<ClassNo, number>,
        ),
      );

      const closestLessonGroups = maxBy(lessonGroupOccurrences, ([, occurrences]) => occurrences);
      if (!closestLessonGroups) return accumulatedModuleLessonConfig;
      const [closestLessonGroupKey] = closestLessonGroups;
      const closestLessonGroup = getSerializedLessonDetails(
        serializedLessonDetailsMap,
        lessonType,
        closestLessonGroupKey,
      );

      return {
        ...accumulatedModuleLessonConfig,
        [lessonType]: closestLessonGroup,
      };
    },
    {} as ModuleLessonConfig,
  );
}

export function serializeLessonDetails<T extends RawLesson>(lesson: T): string {
  const { lessonType, classNo, day, startTime, endTime, venue, weeks } = lesson;

  const abbreviatedLessonType = LESSON_TYPE_ABBREV[lessonType];
  const abbreviatedDayOfWeek = DAY_OF_WEEK_ABBREV[day as DayOfWeek];

  return [
    abbreviatedLessonType,
    classNo,
    abbreviatedDayOfWeek,
    startTime,
    endTime,
    venue,
    weeks,
  ].join('|');
}
