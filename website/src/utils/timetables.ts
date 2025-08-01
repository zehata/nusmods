import { AcadWeekInfo } from 'nusmoderator';
import {
  castArray,
  difference,
  find,
  flatMap,
  flatMapDeep,
  groupBy,
  invert,
  isArray,
  isEmpty,
  isEqual,
  keys,
  last,
  map,
  mapValues,
  partition,
  pick,
  range,
  reduce,
  sample,
  values,
} from 'lodash';
import { addDays, min as minDate, parseISO, startOfDay } from 'date-fns';
import qs from 'query-string';

import {
  ClassNo,
  consumeWeeks,
  GroupedLessons,
  isWeekRange,
  LessonGroup,
  LessonIndex,
  LessonTime,
  LessonType,
  Module,
  ModuleCode,
  NumericWeeks,
  RawLesson,
  Semester,
  SemesterData,
  SerializedWeek,
  WeekRange,
} from 'types/modules';

import {
  ClassNoSemTimetableConfig,
  ClassNoTaModulesConfig,
  DeserializationResult,
  HoverLesson,
  Lesson,
  ModuleLessonConfig,
  ModuleLessonConfigWithLessons,
  SemTimetableConfig,
  SemTimetableConfigWithLessons,
  TaModulesConfig,
} from 'types/timetables';

import { ModuleCodeMap, ModulesMap } from 'types/reducers';
import { ExamClashes } from 'types/views';

import { getTimeAsDate } from './timify';
import { getModuleTimetable, getExamDate, getExamDuration, getModuleSemesterData } from './modules';
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

// Reverse lookup map of LESSON_TYPE_ABBREV
export const LESSON_ABBREV_TYPE: { [key: string]: LessonType } = invert(LESSON_TYPE_ABBREV);

// Used for module config serialization - these must be query string safe
// See: https://stackoverflow.com/a/31300627
export const LESSON_TYPE_SEP = ';';
export const LESSON_TYPE_KEY_VALUE_SEP = ':';
export const LESSON_SEP = ',';
export const LESSON_GROUP_CRITERIA_SEP = '~';

export const TA_MODULE_SEP = ',';

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
export function randomModuleLessonConfig(module: Module, semester: Semester): ModuleLessonConfig {
  const lessons = getModuleTimetable(module, semester);
  const lessonsByLessonType: { [lessonType: string]: readonly RawLesson[] } = groupBy(
    lessons,
    (lesson) => lesson.lessonType,
  );

  return mapValues(lessonsByLessonType, (lessonsWithLessonType) => {
    const randomLesson = sample(lessonsWithLessonType);
    const groupedLessons = getModuleSemesterData(module, semester)?.groupedLessons;
    if (!(randomLesson && groupedLessons)) return [];
    return getLessonGroup(randomLesson, groupedLessons);
  });
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
  return mapValues(moduleLessonConfig, (lessonIndices: LessonIndex[]) => {
    const lessons = getModuleTimetable(module, semester);
    const newLessons = lessons.filter((lesson: RawLesson) =>
      lessonIndices.includes(lesson.lessonIndex),
    );
    return newLessons.map((lesson: RawLesson) => ({
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
export function timetableLessonsArray(timetable: SemTimetableConfigWithLessons): Lesson[] {
  return flatMapDeep(timetable, values);
}

//  Groups flat array of lessons by day.
//  {
//    Monday: [Lesson, Lesson, ...],
//    Tuesday: [Lesson, ...],
//  }
export function groupLessonsByDay<T extends RawLesson>(lessons: T[]): { [dayText: string]: T[] } {
  return groupBy(lessons, (lesson) => lesson.day);
}

export function sortLessons<T extends RawLesson>(lessons: T[]): T[] {
  return lessons.sort((a, b) => {
    const timeDiff = a.startTime.localeCompare(b.startTime);
    return timeDiff !== 0 ? timeDiff : a.classNo.localeCompare(b.classNo);
  });
}

const serializeWeekRanges = (weekRange: WeekRange): SerializedWeek[] =>
  map(
    weekRange.weeks ?? [''],
    (week) => `${weekRange.start}${weekRange.end}${weekRange.weekInterval}${week}`,
  );

const noContinueWorkaround = (lessonsOnDay: RawLesson[]): boolean => {
  // Do we really need this linter rule? no-continue
  // Theoretically this can be written purely immutably but it's a lot harder to follow
  if (lessonsOnDay.length === 1) {
    return false;
  }

  const sortedLessons = sortLessons(lessonsOnDay);
  const latestEndTimeWithinDayByWeek: {
    [week: SerializedWeek]: LessonTime;
  } = {};
  for (
    let sortedLessonsIndex = 0;
    sortedLessonsIndex < sortedLessons.length;
    sortedLessonsIndex += 1
  ) {
    const lesson = sortedLessons[sortedLessonsIndex];
    const lessonWeeks: SerializedWeek[] = isWeekRange(lesson.weeks)
      ? serializeWeekRanges(lesson.weeks)
      : map(lesson.weeks, String);
    for (let weekIndex = 0; weekIndex < lessonWeeks.length; weekIndex += 1) {
      const week = lessonWeeks[weekIndex];
      if (lesson.startTime < latestEndTimeWithinDayByWeek[week]) return true;
      latestEndTimeWithinDayByWeek[week] = lesson.endTime;
    }
  }
  return false;
};

const doLessonsInArrayOverlap = (lessons: RawLesson[]): boolean => {
  // Lessons on different days will never overlap
  const lessonsByDay: RawLesson[][] = values(groupLessonsByDay(lessons));
  for (let dayIndex = 0; dayIndex < lessonsByDay.length; dayIndex += 1) {
    const lessonsOnDay = lessonsByDay[dayIndex];
    if (noContinueWorkaround(lessonsOnDay)) return true;
  }
  return false;
};

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
export function arrangeLessonsWithinDay<T extends RawLesson>(lessons: T[]): T[][] {
  const rows: T[][] = [[]];
  if (isEmpty(lessons)) {
    return rows;
  }
  const sortedLessons = sortLessons(lessons);
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
export function arrangeLessonsForWeek<T extends RawLesson>(lessons: T[]): { [x: string]: T[][] } {
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
  // TODO: use lesson group logic
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

// TODO: update the jsdocs ugh there are so many
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
): [ModuleLessonConfig, LessonType[]] {
  const validLessons = getModuleTimetable(module, semester);
  const lessonsByType = groupBy(validLessons, (lesson) => lesson.lessonType);

  const groupedLessons = getModuleSemesterData(module, semester)?.groupedLessons;
  if (!groupedLessons) return [lessonConfig, []];

  const validationResult = reduce(
    groupedLessons,
    (
      accumulated: {
        validatedLessonConfig: ModuleLessonConfig;
        updatedLessonType: LessonType[];
      },
      lessons: Record<LessonGroup, LessonIndex[]>,
      lessonType: LessonType,
    ) => {
      // Check that the lesson exists and is valid. If it is not, insert a random
      // valid lesson. This covers both
      //
      // - lesson type is not in the original timetable (ie. a new lesson type was introduced)
      //   in which case classNo is undefined and thus would not match
      // - classNo is not valid anymore (ie. the class was removed)
      //
      // If a lesson type is removed, then it simply won't be copied over

      const { validatedLessonConfig, updatedLessonType } = accumulated;
      const moduleConfigLessonTypeLessonIndices = lessonConfig[lessonType];

      if (!isArray(moduleConfigLessonTypeLessonIndices)) {
        if (moduleConfigLessonTypeLessonIndices in groupedLessons) {
          return {
            validatedLessonConfig: {
              ...validatedLessonConfig,
              [lessonType]: lessons[moduleConfigLessonTypeLessonIndices],
            },
            updatedLessonType,
          };
        }

        return accumulated;
      }

      // If the module is a TA module, we check that all lessons belong to the lesson type
      if (isTa) {
        const lessonTypeLessonIndices = map(flatMap(lessons), 'lessonIndex');
        const valid = moduleConfigLessonTypeLessonIndices.some(
          (lessonIndex) => !lessonTypeLessonIndices.includes(lessonIndex),
        );

        if (valid)
          return {
            validatedLessonConfig: {
              ...validatedLessonConfig,
              [lessonType]: moduleConfigLessonTypeLessonIndices,
            },
            updatedLessonType,
          };

        return {
          validatedLessonConfig: {
            ...validatedLessonConfig,
            [lessonType]: [],
          },
          updatedLessonType,
        };
      }

      if (!isTa) {
        // If the module is a normal non-TA module, we check all lessons belong to the same lesson group
        const firstLessonGroupIndices = map(
          find(lessons, (lessonGroup) =>
            map(lessonGroup, 'lessonIndex').includes(moduleConfigLessonTypeLessonIndices[0]),
          ),
          'lessonIndex',
        );
        const valid = !moduleConfigLessonTypeLessonIndices.some(
          (lessonIndex) => !firstLessonGroupIndices.includes(lessonIndex),
        );

        if (valid)
          return {
            validatedLessonConfig: {
              ...validatedLessonConfig,
              [lessonType]: moduleConfigLessonTypeLessonIndices,
            },
            updatedLessonType,
          };

        return {
          validatedLessonConfig: {
            ...validatedLessonConfig,
            [lessonType]: [],
          },
          updatedLessonType,
        };
      }

      return {
        validatedLessonConfig: {
          ...validatedLessonConfig,
          [lessonType]: moduleConfigLessonTypeLessonIndices,
        },
        updatedLessonType: [...updatedLessonType, lessonType],
      };
    },
    {
      validatedLessonConfig: {},
      updatedLessonType: [],
    } as {
      validatedLessonConfig: ModuleLessonConfig;
      updatedLessonType: LessonType[];
    },
  );
  const { validatedLessonConfig, updatedLessonType } = validationResult;
  // Add all of the removed lesson types to the array of updated lesson types
  return [
    validatedLessonConfig,
    [...updatedLessonType, ...difference(Object.keys(lessonConfig), Object.keys(lessonsByType))],
  ];
}

// TODO: take semesterdata instead
/**
 * Compares a lesson to a list of other lessons to get the lessons that would fit into the same lesson group.
 * @see GroupedLessons
 * @param compareLesson
 * @param lessons
 * @returns
 */
export function getLessonGroup(
  { lessonType, lessonIndex }: RawLesson,
  groupedLessons: GroupedLessons,
): LessonIndex[] {
  return (
    find(groupedLessons[lessonType], (lessonGroup) =>
      lessonGroup.some((lesson) => lesson === lessonIndex),
    ) ?? []
  );
}

/**
 * Disambiguates lessons into groups keyed with an identifier using the disambiguation methods provided
 * @param lessons Lessons to disambiguate
 * @param disambiguationMethods Disambiguation methods to try. Subsequent disambiguation methods are only tried for groups of lessons that overlap each other.
 * @param prevIdentifier Identifiers will be prepended with this string
 * @returns
 */
const disambiguateLessons = (
  lessons: RawLesson[],
  disambiguationMethods: ((lesson: RawLesson) => string)[],
  prevIdentifier?: string,
): {
  [lessonGroup: LessonGroup]: LessonIndex[];
} => {
  const [disambiguateBy, ...nextDisambiguationMethods] = disambiguationMethods;
  const lessonsByIdentifier = groupBy(lessons, disambiguateBy);
  return reduce(
    lessonsByIdentifier,
    (groupedLessons, lessonsWithIdentifier, identifier) => {
      const currentLevelIdentifier = prevIdentifier
        ? `${prevIdentifier}${LESSON_GROUP_CRITERIA_SEP}${identifier}`
        : identifier;
      if (!doLessonsInArrayOverlap(lessonsWithIdentifier)) {
        return {
          ...groupedLessons,
          [currentLevelIdentifier]: map(lessonsWithIdentifier, 'lessonIndex'),
        };
      }

      // Fallback to grouping by lesson index when there are no more disambiguation methods to try
      if (!nextDisambiguationMethods.length) {
        const lessonIndices = map(lessonsWithIdentifier, 'lessonIndex');
        return {
          ...groupedLessons,
          ...groupBy(lessonIndices),
        };
      }

      return {
        ...groupedLessons,
        ...disambiguateLessons(
          lessonsWithIdentifier,
          nextDisambiguationMethods,
          currentLevelIdentifier,
        ),
      };
    },
    {} as { [lessonGroup: LessonGroup]: LessonIndex[] },
  );
};

export const splitIntoGroupedLessons = (
  lessons: readonly Omit<RawLesson, 'lessonIndex'>[],
): GroupedLessons => {
  const lessonsWithIndex = map(lessons, (lesson, lessonIndex) => ({ ...lesson, lessonIndex }));
  return mapValues(
    groupBy(lessonsWithIndex, (lesson) => lesson.lessonType),
    (lessonsWithLessonType) =>
      disambiguateLessons(lessonsWithLessonType, [
        (lesson) => lesson.classNo,
        (lesson) => lesson.venue,
        (lesson) =>
          !isWeekRange(lesson.weeks)
            ? lesson.weeks.join()
            : `${lesson.startTime}${lesson.endTime}${lesson.weeks.weeks?.join()}`,
        (lesson) => `${lesson.lessonIndex}`,
      ]),
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

function serializeModuleConfig(config: ModuleLessonConfig): string {
  // {
  //   Lecture: [0, 1],
  //   Laboratory: [2, 3]
  // }
  // =>
  // LEC:(0,1);LAB:(2,3)
  return map(
    config,
    (lessonIndex, lessonType) =>
      `${LESSON_TYPE_ABBREV[lessonType]}${LESSON_TYPE_KEY_VALUE_SEP}(${lessonIndex.join(
        LESSON_SEP,
      )})`,
  ).join(';');
}

// Converts a timetable config to query string
// eg:
// {
//   CS2104: { Lecture: '1', Tutorial: '2' },
//   CS2107: { Lecture: '1', Tutorial: '8' },
// }
// => CS2104=LEC:1,TUT:2&CS2107=LEC:1,TUT:8
export function serializeTimetable(timetable: SemTimetableConfig): string {
  // We are using query string safe characters, so this encoding is unnecessary
  return qs.stringify(mapValues(timetable, serializeModuleConfig), { encode: false });
}

export function injectLessonIndex(timetable: readonly RawLesson[]) {
  return timetable.map((lesson, lessonIndex) => ({
    ...lesson,
    lessonIndex,
  }));
}

export function parseClassNoTaModulesConfig(
  taParams: string[],
  modules: ModulesMap,
  preFilledGetModuleSemesterData: (module: Module) => SemesterData | undefined,
) {
  // Parse v1 serialization TA modules
  // CS2100(TUT:2,TUT:3,LAB:1),CS2107(TUT:8)
  const taSerialized = taParams[-1];
  return reduce(
    taSerialized.split(`)${TA_MODULE_SEP}`),
    (taTimetableConfig, moduleConfig) => {
      const moduleCodeMatches = moduleConfig.match(/(.*)\(/);
      if (moduleCodeMatches === null) {
        return taTimetableConfig;
      }

      const lessonsMatches = moduleConfig.match(/\((.*)\)/);
      if (lessonsMatches === null) {
        return taTimetableConfig;
      }

      const moduleCode = moduleCodeMatches[1];
      const lessons = lessonsMatches[1];
      const semesterData = preFilledGetModuleSemesterData(modules[moduleCode]);
      if (!semesterData) return taTimetableConfig;
      const moduleLessonConfig = lessons
        .split(LESSON_SEP)
        .reduce((accumulatedModuleLessonConfig, lesson) => {
          const [lessonTypeAbbr, classNo] = lesson.split(LESSON_TYPE_KEY_VALUE_SEP);
          const lessonType = LESSON_ABBREV_TYPE[lessonTypeAbbr];
          const { groupedLessons } = semesterData;
          const lessonIndices = findLessonIndicesFromClassNo(lessonType, classNo, groupedLessons);
          if (!lessonIndices?.length) return accumulatedModuleLessonConfig;
          // Ignore unparsable/invalid keys
          if (!lessonType) return accumulatedModuleLessonConfig;
          return {
            ...accumulatedModuleLessonConfig,
            [lessonType]: [...accumulatedModuleLessonConfig[lessonType], ...lessonIndices],
          } as ModuleLessonConfig;
        }, {} as ModuleLessonConfig);

      return {
        ...taTimetableConfig,
        [moduleCode]: moduleLessonConfig,
      } as SemTimetableConfig;
    },
    {} as SemTimetableConfig,
  );
}

export function parseLessonGroupModuleLessonConfig(
  moduleLessonConfig: ModuleLessonConfig,
  serializedModuleLessonConfig: string,
) {
  // serializedModuleLessonConfig = LEC:(0,1);TUT:(3)
  return reduce(
    serializedModuleLessonConfig.split(LESSON_TYPE_SEP),
    (accumulatedModuleLessonConfig, lessonTypeSerialized) => {
      // lessonTypeSerialized = LEC:(0,1)
      const [lessonTypeAbbr, lessonIndicesSerialized] =
        lessonTypeSerialized.split(LESSON_TYPE_KEY_VALUE_SEP);
      const lessonIndices = map(
        lessonIndicesSerialized.slice(1, -1).split(LESSON_SEP),
        (lessonIndex) => parseInt(lessonIndex, 10),
      );
      const lessonType = LESSON_ABBREV_TYPE[lessonTypeAbbr];
      return {
        ...accumulatedModuleLessonConfig,
        [lessonType]: accumulatedModuleLessonConfig[lessonType]
          ? [...accumulatedModuleLessonConfig[lessonType], ...lessonIndices]
          : lessonIndices,
      };
    },
    moduleLessonConfig,
  );
}

export function parseClassNoModuleLessonConfig(
  moduleLessonConfig: ModuleLessonConfig,
  serializedModuleLessonConfig: string,
  moduleSemesterData: SemesterData,
) {
  return reduce(
    serializedModuleLessonConfig.split(LESSON_SEP),
    (accumulatedModuleLessonConfig, lessonTypeSerialized) => {
      // lessonTypeSerialized = LEC:0
      const [lessonTypeAbbr, classNo] = lessonTypeSerialized.split(LESSON_TYPE_KEY_VALUE_SEP);
      const lessonType = LESSON_ABBREV_TYPE[lessonTypeAbbr];
      const semesterData = moduleSemesterData;
      const { groupedLessons } = semesterData;
      const lessonIndices = findLessonIndicesFromClassNo(lessonType, classNo, groupedLessons);
      if (!lessonIndices?.length) return accumulatedModuleLessonConfig;
      return {
        ...accumulatedModuleLessonConfig,
        [lessonType]: accumulatedModuleLessonConfig[lessonType]
          ? [...accumulatedModuleLessonConfig[lessonType], ...lessonIndices]
          : lessonIndices,
      };
    },
    moduleLessonConfig,
  );
}

export function deserializeTimetable(
  serialized: string,
  modules: ModulesMap,
  preFilledGetModuleSemesterData: (module: Module) => SemesterData | undefined,
): DeserializationResult {
  const params = qs.parse(serialized);

  const taParams = params.ta;
  // If TA modules were serialized using the old format, then we deserialize it first so we can skip deserializing the module code down the line
  const taModulesConfig =
    taParams && taParams[-1][-1] !== ')'
      ? parseClassNoTaModulesConfig(castArray(taParams), modules, preFilledGetModuleSemesterData)
      : {};

  return reduce(
    params,
    (deserialized, paramsValue, paramsKey) => {
      if (!paramsValue) return deserialized;
      // v1: classNo
      // given the params &CS2103T=LEC:0,TUT:3
      // paramsKey = CS2103T
      // paramsValue = LEC:0,TUT:3
      // v2: lesson groups
      // given the params &CS2103T=LEC:(0,1);TUT:(3)&CS2103T=LEC:(2),TUT:(4)
      // paramsKey = CS2103T
      // paramsValue = ["LEC:(0,1);TUT:(3)", "LEC:(2);TUT:(4)"]
      switch (paramsKey) {
        case 'hidden':
        case 'ta': {
          const moduleCodes = reduce(
            castArray(paramsValue),
            (accumulatedModules, paramValue) => {
              if (paramsKey === 'ta' && paramValue[-1] === ')') return accumulatedModules;

              const trimmedParamValue =
                paramValue[-1] === ')' ? paramValue.slice(1, -1) : paramValue;
              return [...accumulatedModules, ...trimmedParamValue.split(TA_MODULE_SEP)];
            },
            [] as ModuleCode[],
          );
          return {
            ...deserialized,
            [paramsKey]: [...deserialized[paramsKey], ...moduleCodes],
          };
        }

        default: {
          const moduleCode = paramsKey;
          const moduleLessonConfig = reduce(
            castArray(paramsValue),
            (accumulatedModuleLessonConfig, serializedModuleLessonConfig) => {
              // If using the v2 serialization
              if (
                serializedModuleLessonConfig &&
                serializedModuleLessonConfig[serializedModuleLessonConfig.length - 1] === ')'
              )
                return parseLessonGroupModuleLessonConfig(
                  accumulatedModuleLessonConfig,
                  serializedModuleLessonConfig,
                );

              // If class is in the TA modules, use the TA module version
              if (moduleCode in taModulesConfig) return taModulesConfig[moduleCode];

              // If using the v1 serialization
              // serializedModuleLessonConfig = LEC:0,TUT:3
              const moduleSemesterData = preFilledGetModuleSemesterData(modules[moduleCode]);
              if (!moduleSemesterData) return accumulatedModuleLessonConfig;
              return parseClassNoModuleLessonConfig(
                accumulatedModuleLessonConfig,
                serializedModuleLessonConfig,
                moduleSemesterData,
              );
            },
            {} as ModuleLessonConfig,
          );
          return {
            ...deserialized,
            semTimetableConfig: {
              ...deserialized.semTimetableConfig,
              [moduleCode]: moduleLessonConfig,
            },
          };
        }
      }
    },
    {
      semTimetableConfig: taModulesConfig,
      ta: keys(taModulesConfig),
      hidden: [],
    } as DeserializationResult,
  );
}

export function serializeHidden(hiddenModules: ModuleCode[]): string {
  return `&hidden=${hiddenModules.join(',')}`;
}

export function serializeTa(taModules: TaModulesConfig) {
  // eg:
  // eg:
  // {
  //   CS2100: [ ['Tutorial', '2'], ['Tutorial', '3'], ['Laboratory', '1'] ],
  //   CS2107: [ ['Tutorial', '8'] ],
  // }
  // => &ta=CS2100(TUT:2,TUT:3,LAB:1);CS2107(TUT:8)
  // ["CS2100", "CS2107"] => (CS2100,CS2107)
  return `&ta=${taModules.join(TA_MODULE_SEP)}`;
}

export function deserializeTaTimetable(serialized: string): SemTimetableConfig {
  const params = qs.parse(serialized);
  if (!params.ta) return {} as SemTimetableConfig;
  // If user manually enters multiple TA query keys, use latest one
  const ta = Array.isArray(params.ta) ? last(params.ta) : params.ta;
  if (!ta) return {} as SemTimetableConfig;
  return ta.split(`)${LESSON_SEP}`).reduce((deserialized, moduleConfig) => {
    const moduleCodeMatches = moduleConfig.match(/(.*)\(/);
    if (moduleCodeMatches === null) {
      return deserialized;
    }

    const lessonsMatches = moduleConfig.match(/\((.*)\)/);
    if (lessonsMatches === null) {
      return deserialized;
    }

    const moduleCode = moduleCodeMatches[1];
    const lessons = lessonsMatches[1];
    const moduleLessonConfig = lessons
      .split(LESSON_SEP)
      .reduce((accumulatedModuleLessonConfig, lesson) => {
        const [lessonTypeAbbr, lessonIndices] = lesson.split(LESSON_TYPE_KEY_VALUE_SEP);
        const lessonType = LESSON_ABBREV_TYPE[lessonTypeAbbr];
        // Ignore unparsable/invalid keys
        if (!lessonType) return accumulatedModuleLessonConfig;
        return {
          ...accumulatedModuleLessonConfig,
          [lessonType]: lessonIndices,
        } as ModuleLessonConfig;
      }, {} as ModuleLessonConfig);

    return {
      ...deserialized,
      [moduleCode]: moduleLessonConfig,
    } as SemTimetableConfig;
  }, {} as SemTimetableConfig);
}

export function isSameTimetableConfig(t1: SemTimetableConfig, t2: SemTimetableConfig): boolean {
  return isEqual(t1, t2);
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

export function getHoverLesson(lesson: Lesson & { lessonGroup?: string }): HoverLesson {
  return {
    moduleCode: lesson.moduleCode,
    lessonType: lesson.lessonType,
    lessonIndex: lesson.lessonIndex,
    lessonGroup: lesson.lessonGroup,
  };
}

/**
 * Obtain a semi-unique key for a lesson
 */
export function getLessonIdentifier(lesson: Lesson): string {
  return `${lesson.moduleCode}-${LESSON_TYPE_ABBREV[lesson.lessonType]}-${lesson.classNo}`;
}

export function findLessonIndicesFromClassNo(
  lessonType: LessonType,
  classNo: ClassNo,
  groupedLessons: GroupedLessons,
): number[] {
  // TODO: notify user of ambiguity
  if (!(classNo in groupedLessons[lessonType])) return [];
  return groupedLessons[lessonType][classNo];
}

export function migrateTaModulesConfig(
  classNoTaModulesConfig: TaModulesConfig | ClassNoTaModulesConfig,
): TaModulesConfig {
  if (isArray(classNoTaModulesConfig)) return classNoTaModulesConfig;
  return keys(classNoTaModulesConfig);
}

export function migrateSemTimetableConfig(
  semTimetableConfig: SemTimetableConfig | ClassNoSemTimetableConfig,
  taModulesConfig: TaModulesConfig | ClassNoTaModulesConfig,
  modules: ModulesMap,
  semester: Semester,
): SemTimetableConfig {
  const migratedSemTimetable = mapValues(semTimetableConfig, (moduleLessonConfig, moduleCode) => {
    const module = modules[moduleCode];
    return mapValues(moduleLessonConfig, (lessonsInLessonType, lessonType) => {
      if (isArray(lessonsInLessonType)) return lessonsInLessonType;
      const groupedLessons = getModuleSemesterData(module, semester)?.groupedLessons;
      if (!groupedLessons) return [];
      const lessonIndices = findLessonIndicesFromClassNo(
        lessonType,
        lessonsInLessonType,
        groupedLessons,
      );
      return lessonIndices ?? [];
    });
  });
  return combineTimetableConfig(migratedSemTimetable, taModulesConfig, modules, semester);
}

export function combineTimetableConfig(
  semTimetableConfig: SemTimetableConfig,
  taModulesConfig: TaModulesConfig | ClassNoTaModulesConfig,
  modules: ModulesMap,
  semester: Semester,
) {
  if (isArray(taModulesConfig)) {
    return semTimetableConfig;
  }
  return reduce(
    taModulesConfig,
    (taModuleSemTimetableConfig, taModuleConfig, moduleCode) => {
      const module = modules[moduleCode];
      return reduce(
        taModuleConfig,
        (lessonTypeAccumulatedSemTimetableConfig, [lessonsInLessonType, lessonType]) => {
          const groupedLessons = getModuleSemesterData(module, semester)?.groupedLessons;
          if (isArray(lessonsInLessonType))
            return {
              ...lessonTypeAccumulatedSemTimetableConfig,
              [moduleCode]: {
                ...lessonTypeAccumulatedSemTimetableConfig[moduleCode],
                [lessonType]: [
                  ...lessonTypeAccumulatedSemTimetableConfig[moduleCode][lessonType],
                  ...lessonsInLessonType,
                ],
              },
            };
          if (!groupedLessons) return lessonTypeAccumulatedSemTimetableConfig;
          const lessonIndices = findLessonIndicesFromClassNo(
            lessonType,
            lessonsInLessonType,
            groupedLessons,
          );
          if (!lessonIndices) return lessonTypeAccumulatedSemTimetableConfig;
          return {
            ...lessonTypeAccumulatedSemTimetableConfig,
            [moduleCode]: {
              ...lessonTypeAccumulatedSemTimetableConfig[moduleCode],
              [lessonType]: [
                ...lessonTypeAccumulatedSemTimetableConfig[moduleCode][lessonType],
                ...lessonIndices,
              ],
            },
          };
        },
        taModuleSemTimetableConfig,
      );
    },
    semTimetableConfig,
  );
}
