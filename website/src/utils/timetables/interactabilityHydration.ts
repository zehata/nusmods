import { groupBy, keys, mapValues } from 'lodash-es';

import {
  LessonId,
  LessonType,
  ModuleCode,
  ModuleLessonMap,
  RawLesson,
  Semester,
} from 'types/modules';

import {
  ColoredLesson,
  InteractableLesson,
  Lesson,
  SemTimetableConfigWithLessons,
} from 'types/timetables';

import { ColorMapping, ModulesMap } from 'types/reducers';
import { getModuleLessonMap, getModuleTimetable } from 'utils/modules';
import { serializeLessonDetails } from './lessonId';

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
 * Hydrate timetable lessons with interactability info\
 * See type defintion of `InteractableLesson` for properties added
 */
export function getInteractableLessons(
  timetableLessons: SemTimetableConfigWithLessons<Lesson>,
  taModules: ModuleCode[],
  modules: ModulesMap,
  semester: Semester,
  colors: ColorMapping,
  readOnly: boolean,
  activeLesson: Lesson | null,
): SemTimetableConfigWithLessons<InteractableLesson> {
  const moduleTimetables = mapValues(modules, (module) => getModuleTimetable(module, semester));
  const activeLessonId = activeLesson ? serializeLessonDetails(activeLesson) : null;

  return mapValues(
    timetableLessons,
    (lessonMap: ModuleLessonMap<RawLesson>, moduleCode: ModuleCode) => {
      const isTaInTimetable = taModules.includes(moduleCode);

      return mapValues(
        lessonMap,
        (
          lessonsWithLessonType,
          lessonType: LessonType,
        ): { [lessonId: LessonId]: InteractableLesson } => {
          const isSameModuleAndLessonType =
            moduleCode === activeLesson?.moduleCode && lessonType === activeLesson?.lessonType;

          const configLessonIds: LessonId[] = keys(lessonsWithLessonType);
          const lessons =
            activeLesson && isSameModuleAndLessonType
              ? getModuleLessonMap(modules[moduleCode], semester)[lessonType]
              : lessonsWithLessonType;

          return mapValues(lessons, (lesson, lessonId: LessonId): InteractableLesson => {
            const isActive = isSameModuleAndLessonType && lessonId === activeLessonId;
            const canBeSelectedAsActiveLesson =
              !readOnly &&
              (isTaInTimetable ||
                areOtherClassesAvailable(moduleTimetables[moduleCode], lessonType));

            const alreadyAddedToLessonConfig = configLessonIds.includes(lessonId);
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
              lessonId,
            };
          });
        },
      );
    },
  );
}
