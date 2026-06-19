import {
  filter,
  first,
  get,
  isArray,
  isEqual,
  isNumber,
  keys,
  map,
  nth,
  pickBy,
  reduce,
  uniq,
} from 'lodash-es';

import {
  LessonIndex,
  ModuleCode,
  RawLesson,
  ModuleLessonMap,
  ClassNo,
  LessonId,
  Semester,
  LessonType,
} from 'types/modules';

import {
  ModuleLessonConfigV1,
  SemTimetableConfigV1,
  TaModulesConfigV1,
  ModuleLessonConfig,
  SemTimetableConfig,
} from 'types/timetables';
import { getModuleLessonMap, getModuleTimetable } from 'utils/modules';

import { serializeLessonDetails } from './lessonId';
import { ModulesMap } from 'types/reducers';

export function isV1(config: ClassNo | LessonIndex[] | LessonId[]): config is ClassNo {
  return !isArray(config);
}

export function isV2(config: LessonIndex[] | LessonId[]): config is LessonIndex[] {
  return isNumber(get(config, 0, undefined));
}

function migrateLessonTypeLessonsFromLessonIndicesToLessonIds(
  timetable: readonly RawLesson[],
  lessonMap: Readonly<ModuleLessonMap<RawLesson>>,
  lessonType: LessonType,
  lessonIndices: LessonIndex[],
  isTa: boolean,
) {
  const lessonsWithLessonType = get(lessonMap, lessonType);
  const configLessons = reduce(
    lessonIndices,
    (accumulatedDeserializedLessons, lessonIndex) => {
      const lesson = nth(timetable, lessonIndex);
      if (!lesson || lesson.lessonType !== lessonType) return accumulatedDeserializedLessons;
      const lessonId = serializeLessonDetails(lesson);
      return {
        ...accumulatedDeserializedLessons,
        [lessonId]: lesson,
      };
    },
    {} as Record<LessonId, RawLesson>,
  );

  const classNos = uniq(map(configLessons, 'classNo'));
  const lessonIds = keys(configLessons);
  if (isTa || classNos.length !== 1) {
    return lessonIds;
  }

  const firstClassNo = first(classNos);
  const lessonsWithClassNo = pickBy(
    lessonsWithLessonType,
    (lesson) => lesson.classNo === firstClassNo,
  );
  if (firstClassNo && isEqual(lessonIds, keys(lessonsWithClassNo))) {
    return [firstClassNo];
  }

  return lessonIds;
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
  lessonMap: Readonly<ModuleLessonMap<RawLesson>>,
  isTa: boolean,
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
          ? migrateLessonTypeLessonsFromLessonIndicesToLessonIds(
              timetable,
              lessonMap,
              lessonType,
              lessonsIdentifier,
              isTa,
            )
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

      if (taClassNos.length === 0) {
        return {
          migratedModuleLessonConfig: {
            ...accumulatedModuleLessonConfig.migratedModuleLessonConfig,
            [lessonType]: [lessonsIdentifier],
          },
          alreadyMigrated: false,
        };
      }

      const classNos = map(taClassNos, '1');
      const lessonIds = keys(
        pickBy(lessonMap[lessonType], (lesson) => classNos.includes(lesson.classNo)),
      );

      return {
        migratedModuleLessonConfig: {
          ...accumulatedModuleLessonConfig.migratedModuleLessonConfig,
          [lessonType]: lessonIds,
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
 * @param modules the modules in the moduleBank, used to find `ClassNo` or `LessonId`
 * @param semester the semester of the timetable to migrate, used to find `ClassNo` or `LessonId`
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
        isTa,
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
