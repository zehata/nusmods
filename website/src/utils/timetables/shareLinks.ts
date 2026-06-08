import {
  castArray,
  filter,
  first,
  get,
  includes,
  invert,
  isArray,
  isEmpty,
  isEqual,
  keys,
  last,
  map,
  mapValues,
  nth,
  omit,
  pickBy,
  reduce,
  some,
  toPairs,
  uniq,
} from 'lodash-es';
import qs, { ParsedQuery } from 'query-string';

import { LessonId, LessonType, ModuleCode, ModuleLessonMap, RawLesson } from 'types/modules';
import { ModulesMap } from 'types/reducers';

import { ModuleLessonConfig, SemTimetableConfig } from 'types/timetables';
import { getModuleLessonMap, getModuleTimetable } from 'utils/modules';

import { LESSON_TYPE_ABBREV } from 'utils/timetables';
import { serializeLessonDetails } from './lessonId';

// Reverse lookup map of LESSON_TYPE_ABBREV
export const LESSON_ABBREV_TYPE: { [key: string]: LessonType } = invert(LESSON_TYPE_ABBREV);

// Used for module config serialization - these must be query string safe
// See: https://stackoverflow.com/a/31300627
export const V1_LESSON_TYPE_SEP = ',';
export const V2_LESSON_TYPE_SEP = ';';
export const LESSON_TYPE_KEY_VALUE_SEP = ':';
export const LESSON_SEP = ',';

export const MODULE_SEP = ',';

/**
 * Serializes a module's lesson config for sharing\
 * Given input `{ Lecture: [0], Tutorial: [1] }`\
 * Will output `LEC:(0),TUT:(1)`
 */
function serializeModuleLessonConfig(config: ModuleLessonConfig, isTa: boolean): string {
  return map(config, (lessonIds, lessonType) => {
    const joinedLessonIds = lessonIds.join(LESSON_SEP);
    const serializedLessonIds = isTa ? `(${joinedLessonIds})` : joinedLessonIds;
    return `${LESSON_TYPE_ABBREV[lessonType]}${LESSON_TYPE_KEY_VALUE_SEP}${serializedLessonIds}`;
  }).join(isTa ? V2_LESSON_TYPE_SEP : V1_LESSON_TYPE_SEP);
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
export function serializeSemTimetableConfig({
  semTimetableConfig,
  hidden,
  ta,
}: {
  semTimetableConfig: SemTimetableConfig;
  hidden: ModuleCode[];
  ta: ModuleCode[];
}): string {
  // We are using query string safe characters, so this encoding is unnecessary
  return qs.stringify(
    {
      ...mapValues(semTimetableConfig, (moduleLessonConfig, moduleCode) =>
        serializeModuleLessonConfig(moduleLessonConfig, includes(ta, moduleCode)),
      ),
      hidden: serializeModuleList(hidden),
      ta: serializeModuleList(ta),
    },
    { encode: false },
  );
}

/**
 * Serializes TA modules for sharing\
 * Given input `["CS1010S", "CS3216"]`\
 * Will output `&ta=CS1010S,CS3216`
 */
export function serializeModuleList(modules: ModuleCode[]): string | undefined {
  if (isEmpty(modules)) return undefined;
  return modules.join(MODULE_SEP);
}

/**
 * Parses a serialized v1 format TA config for module codes\
 * Does not error if the TA module config includes a module code not inside the non-TA module config\
 * @param taSerialized e.g. `CS2100(TUT:2,TUT:3,LAB:1),CS2107(TUT:8)`
 * @returns TA module codes if the module lesson config is v1 format serialized (e.g. `["CS2100","CS2107"]`)\
 * Otherwise, returns an empty array
 */
export function deserializeTaModuleList(taSerialized?: string | null): ModuleCode[] {
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
export function deserializeTaModuleLessonConfigV1(
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
  const taModuleLessonConfigs = reduce(
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
          const classNoLessonIds = map(lessonsWithClassNo, ([lessonId]) => lessonId);

          return {
            ...accumulatedModuleLessonConfig,
            [lessonType]: [
              ...(accumulatedModuleLessonConfig[lessonType] ?? []),
              ...classNoLessonIds,
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

  return taModuleLessonConfigs;
}

export function deserializeTaModuleLessonConfigV2orV3(taSerialized: string) {
  return taSerialized.split(/(?<=\)),/);
}

/**
 * Parses hidden and TA module list
 * @param accumulatedDeserializationResult
 * @param paramsKey currently only 2 params are used as keys for serialized lists of modules: hidden, and ta
 * @param paramsValue
 * @returns
 */
function deserializeHiddenOrTaConfig(paramsValue: string | string[] | null): ModuleCode[] {
  if (!paramsValue) return [];

  const serializedModuleList = isArray(paramsValue) ? last(paramsValue) : paramsValue;
  if (!serializedModuleList || last(serializedModuleList) === ')') return [];

  return serializedModuleList.split(LESSON_SEP);
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
  lessonMap: Readonly<ModuleLessonMap<RawLesson>>,
  isTa: boolean,
): ModuleLessonConfig {
  // LEC:1,TUT:1,REC:1
  return reduce(
    serializedModuleLessonConfig.split(LESSON_SEP),
    (accumulatedModuleLessonConfig, lessonTypeSerialized) => {
      // LEC:1
      const [lessonTypeAbbr, classNo] = lessonTypeSerialized.split(LESSON_TYPE_KEY_VALUE_SEP);
      // ["LEC", "1"]
      const lessonType = get(LESSON_ABBREV_TYPE, lessonTypeAbbr);
      if (!lessonType) return accumulatedModuleLessonConfig;

      const lessonsWithLessonType = get(lessonMap, lessonType);
      const classNoValid = some(lessonsWithLessonType, (lesson) => lesson.classNo === classNo);
      const accumulatedLessonTypeLessonConfig = get(
        accumulatedModuleLessonConfig,
        lessonType,
        [] as string[],
      );
      if (!classNoValid)
        return {
          ...accumulatedModuleLessonConfig,
          [lessonType]: accumulatedLessonTypeLessonConfig,
        };

      if (!isTa) {
        return {
          ...accumulatedModuleLessonConfig,
          [lessonType]: [...accumulatedLessonTypeLessonConfig, classNo],
        };
      }

      const lessonIds = keys(pickBy(lessonsWithLessonType, (lesson) => lesson.classNo === classNo));
      return {
        ...accumulatedModuleLessonConfig,
        [lessonType]: [...accumulatedLessonTypeLessonConfig, ...lessonIds],
      };
    },
    moduleLessonConfig,
  );
}

/**
 * Deserializes a serialized v2 or v3 format lesson config string to a module lesson config

 * @param moduleLessonConfig moduleLessonConfig from previously parsed params to combine with, if any
 * @param serializedModuleLessonConfig e.g. `LEC:(0,1);TUT:(3)` (v2) `TODO` (v3)
 * @param timetable Array of valid lessons
 * @returns Combined moduleLessonConfig
 */
export function deserializeModuleLessonConfigV2andV3(
  moduleLessonConfig: ModuleLessonConfig,
  serializedModuleLessonConfig: string,
  lessonMap: Readonly<ModuleLessonMap<RawLesson>>,
  timetable: readonly RawLesson[],
  isTa: boolean,
): ModuleLessonConfig {
  // LEC:(0,1);TUT:(3)
  return reduce(
    serializedModuleLessonConfig.split(V2_LESSON_TYPE_SEP),
    (accumulatedModuleLessonConfig, lessonTypeSerialized) => {
      // LEC:(0,1)
      const [lessonTypeAbbr, serializedLessonTypeConfig] =
        lessonTypeSerialized.split(LESSON_TYPE_KEY_VALUE_SEP);
      const lessonType = get(LESSON_ABBREV_TYPE, lessonTypeAbbr);
      if (!lessonType) return accumulatedModuleLessonConfig;
      // ["LEC", "0,1"]
      const unwrappedLessonType = serializedLessonTypeConfig.match(/(?<=\()(.*)(?=\))/);
      if (!unwrappedLessonType) {
        return {
          ...accumulatedModuleLessonConfig,
          [lessonType]: [],
        };
      }

      const lessonsWithLessonType = get(lessonMap, lessonType);

      const deserializedLessons = reduce(
        unwrappedLessonType[0].split(LESSON_SEP),
        (accumulatedDeserializedLessons, lessonIdentifier) => {
          const isLessonIndex = /^\d+$/.test(lessonIdentifier); // parseInt coerces "1|..." to 1

          if (isLessonIndex) {
            const lessonIndex = parseInt(lessonIdentifier, 10);
            const lesson = nth(timetable, lessonIndex);
            if (!lesson || lesson.lessonType !== lessonType) return accumulatedDeserializedLessons;
            const lessonId = serializeLessonDetails(lesson);
            return {
              ...accumulatedDeserializedLessons,
              [lessonId]: lesson,
            };
          }

          const lesson = get(lessonsWithLessonType, lessonIdentifier);
          if (!lesson) return accumulatedDeserializedLessons;

          return {
            ...accumulatedDeserializedLessons,
            [lessonIdentifier]: lesson,
          };
        },
        {} as Record<LessonId, RawLesson>,
      );
      const classNos = uniq(map(deserializedLessons, 'classNo'));
      const lessonIds = keys(deserializedLessons);
      if (isTa || classNos.length !== 1) {
        return {
          ...accumulatedModuleLessonConfig,
          [lessonType]: [...get(accumulatedModuleLessonConfig, lessonType, []), ...lessonIds],
        };
      }

      const firstClassNo = first(classNos);
      const lessonsWithClassNo = pickBy(
        lessonsWithLessonType,
        (lesson) => lesson.classNo === firstClassNo,
      );
      if (firstClassNo && isEqual(lessonIds, keys(lessonsWithClassNo))) {
        return {
          ...accumulatedModuleLessonConfig,
          [lessonType]: [...get(accumulatedModuleLessonConfig, lessonType, []), firstClassNo],
        };
      }

      return {
        ...accumulatedModuleLessonConfig,
        [lessonType]: [...get(accumulatedModuleLessonConfig, lessonType, []), ...lessonIds],
      };
    },
    moduleLessonConfig,
  );
}

/**
 * Helper function for {@link deserializeSemTimetableConfig|deserializeTimetable}
 * It parses the serialization string of each module.
 */
function deserializeModuleLessonConfig(
  accumulatedSemTimetableConfig: SemTimetableConfig,
  moduleCode: string,
  serializedModuleLessonConfig: string | string[] | null,
  isTa: boolean,
  getTaModuleLessonConfig: (moduleCode: ModuleCode) => ModuleLessonConfig | undefined,
  modules: ModulesMap,
  semester: number,
): SemTimetableConfig {
  const module = get(modules, moduleCode, undefined);
  if (!module) return accumulatedSemTimetableConfig;

  if (!serializedModuleLessonConfig) {
    return {
      ...accumulatedSemTimetableConfig,
      [moduleCode]: get(accumulatedSemTimetableConfig, moduleCode, {}),
    };
  }

  const lessonMap = getModuleLessonMap(module, semester);
  const timetable = getModuleTimetable(module, semester);
  const moduleLessonConfig = reduce(
    castArray(serializedModuleLessonConfig),
    (accumulatedModuleLessonConfig, serializedModuleLessonConfig) => {
      // If using the lesson group serialization (v2) or the lesson details serialization (v3)
      // paramsKey = CS2103T
      // paramsValue = LEC:(0,1);TUT:(3)
      if (serializedModuleLessonConfig && last(serializedModuleLessonConfig) === ')')
        return deserializeModuleLessonConfigV2andV3(
          accumulatedModuleLessonConfig,
          serializedModuleLessonConfig,
          lessonMap,
          timetable,
          isTa,
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
        isTa,
      );
    },
    {} as ModuleLessonConfig,
  );

  return {
    ...accumulatedSemTimetableConfig,
    [moduleCode]: moduleLessonConfig,
  };
}

/**
 * Entry point to deserialize a serialized timetable string\
 * Checks serialization format and parses accordingly
 * - V1 format: `?CS4243=LEC:1,LAB:1&CS1010S=LEC:1,TUT:1,REC:1&ta=CS1010S(LEC:1,TUT:1,TUT:2,REC:1)&hidden=CS1010S`
 * - V2 format: `?CS4243=LEC:(5);LAB:(0)&CS1010S=LEC:(0);TUT:(11,22);REC:(1)&ta=CS1010S&hidden=CS1010S`
 * - V3 format: `?CS4243=LEC:1,LAB:1&CS1010S=LEC:(1|WED|1000|1200|LT26|1_2_3_4_5_6_7_8_9_10_11_12_13);TUT:(1|MON|0900|1000|COM1-0203|3_4_5_6_7_8_9_10_11_12_13,2|MON|1000|1100|COM1-0217|3_4_5_6_7_8_9_10_11_12_13;REC:(1|THU|1200|1300|S14-0619|1_2_3_4_5_6_7_8_9_10_11_12_13)&ta=CS1010S&hidden=CS1010S`
 * @param serialized
 * @param getModuleSemesterTimetable
 * @returns
 */
export function deserializeSemTimetableConfig(
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
  const taModuleLessonConfigs = deserializeTaModuleLessonConfigV1(taParams, modules, semester);

  const getTaModuleLessonConfig = (moduleCode: ModuleCode): ModuleLessonConfig | undefined =>
    get(taModuleLessonConfigs, moduleCode);

  const serializedSemTimetableConfig = omit(params, ['hidden', 'ta']);
  const taModuleCodes = [
    ...keys(taModuleLessonConfigs),
    ...deserializeHiddenOrTaConfig(get(params, 'ta')),
  ];
  const taModuleCodesSet = new Set(taModuleCodes);

  const semTimetableConfig = reduce(
    serializedSemTimetableConfig,
    (accumulatedSemTimetableConfig, serializedModuleLessonConfig, moduleCode) =>
      deserializeModuleLessonConfig(
        accumulatedSemTimetableConfig,
        moduleCode,
        serializedModuleLessonConfig,
        taModuleCodesSet.has(moduleCode),
        getTaModuleLessonConfig,
        modules,
        semester,
      ),
    {} as SemTimetableConfig,
  );

  const validModuleCodes = new Set(keys(semTimetableConfig));
  return {
    semTimetableConfig,
    ta: filter(taModuleCodes, (moduleCode) => validModuleCodes.has(moduleCode)),
    hidden: filter(deserializeHiddenOrTaConfig(get(params, 'hidden')), (moduleCode) =>
      validModuleCodes.has(moduleCode),
    ),
  };
}

export function getImportedModuleCodes(parsedQuery: ParsedQuery) {
  const taSerialized = isArray(parsedQuery.ta) ? last(parsedQuery.ta) : parsedQuery.ta;
  const taModuleCodes = deserializeTaModuleList(taSerialized);
  return uniq([...keys(omit(parsedQuery, ['ta', 'hidden'])), ...taModuleCodes]);
}
