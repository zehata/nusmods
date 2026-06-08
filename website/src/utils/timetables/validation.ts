import {
  first,
  get,
  includes,
  isEqual,
  keys,
  map,
  partition,
  pick,
  reduce,
  size,
  some,
} from 'lodash-es';

import { LessonId, Module, ModuleCode, ModuleLessonMap, RawLesson, Semester } from 'types/modules';

import { ModuleLessonConfig, SemTimetableConfig } from 'types/timetables';

import { ModuleCodeMap } from 'types/reducers';
import { getRecoveryClassNo } from 'utils/timetables';
import {
  deserializeLessonDetails,
  getClosestClassNo,
  getRecoverySerializedLessonId,
} from './lessonId';
import { getModuleLessonMap } from 'utils/modules';

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
  lessonMap: Readonly<ModuleLessonMap<RawLesson>>,
): {
  validatedLessonConfig: ModuleLessonConfig;
  valid: boolean;
} {
  const { config: validatedLessonConfig, valid } = reduce(
    lessonConfig,
    (accumulatedValidationResult, configLessonTypeLessonIds, lessonType) => {
      const validLessonTypeLessonIds: LessonId[] = keys(get(lessonMap, lessonType, {}));
      if (!validLessonTypeLessonIds.length) {
        return {
          config: accumulatedValidationResult.config,
          valid: false,
        };
      }
      const hasInvalidLesson = some(
        configLessonTypeLessonIds,
        (lessonId) => !validLessonTypeLessonIds.includes(lessonId),
      );
      return {
        config: {
          ...accumulatedValidationResult.config,
          [lessonType]: hasInvalidLesson
            ? getRecoverySerializedLessonId(
                get(lessonMap, lessonType, {}),
                configLessonTypeLessonIds,
              )
            : configLessonTypeLessonIds,
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
 * Valid non-TA modules must have one and only one classNo for each lesson type
 * @param lessonConfig lesson configs to validate
 * @param validLessons lessons to validate against
 * @returns
 * - validated non-TA lesson config
 *     - invalid lesson configs are recovered to lessons with the classNo of the first lesson in the invalid config
 *     - if a classNo cannot be obtained, the classNo of the first lesson in the timetable is used
 * - whether the input is valid, to signal to skip dispatch
 */
export async function validateNonTaModuleLesson(
  lessonConfig: ModuleLessonConfig,
  lessonMap: Readonly<ModuleLessonMap<RawLesson>>,
): Promise<{
  validatedLessonConfig: ModuleLessonConfig;
  valid: boolean;
}> {
  const lessonTypesInLessonConfig = keys(lessonConfig);

  const lessonTypesValidationResults = await Promise.all(
    map(lessonMap, async (validLessons, lessonType) => {
      const lessonTypeInLessonConfig = lessonTypesInLessonConfig.includes(lessonType);
      const configLessonIds: LessonId[] = get(lessonConfig, lessonType, []);
      const firstLessonId = first(configLessonIds);

      if (!lessonTypeInLessonConfig || !firstLessonId) {
        const validLessonIds = getRecoveryClassNo(validLessons);
        return {
          lessonType,
          validLessonIds,
          valid: false,
        };
      }

      if (configLessonIds.length === 1 && !includes(firstLessonId, '|')) {
        const valid = some(validLessons, (lesson) => lesson.classNo === firstLessonId);

        return {
          lessonType,
          validLessonIds: valid ? [firstLessonId] : getRecoveryClassNo(validLessons),
          valid,
        };
      }

      if (size(pick(validLessons, configLessonIds)) > 0) {
        const closestClassNo = getClosestClassNo(validLessons, configLessonIds);
        if (closestClassNo)
          return {
            lessonType,
            validLessonIds: [closestClassNo],
            valid: false,
          };
      }

      const firstLesson = await Promise.resolve(deserializeLessonDetails(firstLessonId)).catch(
        () => null,
      );

      if (firstLesson === null) {
        const validLessonIds = getRecoveryClassNo(validLessons);
        return {
          lessonType,
          validLessonIds,
          valid: false,
        };
      }

      return {
        lessonType,
        validLessonIds: [firstLesson.classNo],
        valid: false,
      };
    }),
  );

  const { config: validatedLessonConfig, valid: configValid } = reduce(
    lessonTypesValidationResults,
    (accumulated, { lessonType, validLessonIds, valid }) => {
      return {
        config: {
          ...accumulated.config,
          [lessonType]: validLessonIds,
        },
        valid: accumulated.valid && valid,
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
export async function validateModuleLessons(
  semester: Semester,
  lessonConfig: ModuleLessonConfig,
  module: Module,
  isTa: boolean,
): Promise<{ validatedLessonConfig: ModuleLessonConfig; valid: boolean }> {
  const lessonMap = getModuleLessonMap(module, semester);

  if (isTa) {
    return Promise.resolve(validateTaModuleLessons(lessonConfig, lessonMap));
  }

  return validateNonTaModuleLesson(lessonConfig, lessonMap);
}
