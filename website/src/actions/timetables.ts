import {
  each,
  entries,
  flatMap,
  forEach,
  intersection,
  isArray,
  mapValues,
  maxBy,
  reduce,
} from 'lodash';

import type {
  ColorIndex,
  Lesson,
  TaModulesConfig,
  ModuleLessonConfig,
  SemTimetableConfig,
  TimetableConfig,
} from 'types/timetables';
import type { Dispatch, GetState } from 'types/redux';
import type { ColorMapping, ConfigSchema, ModulesMap, TaModulesMap } from 'types/reducers';
import type {
  LessonGroup,
  LessonIndex,
  LessonType,
  Module,
  ModuleCode,
  Semester,
} from 'types/modules';

import { fetchModule } from 'actions/moduleBank';
import { openNotification } from 'actions/app';
import { getModuleCondensed } from 'selectors/moduleBank';
import {
  migrateSemTimetableConfig,
  migrateTaModulesConfig,
  randomModuleLessonConfig,
  validateModuleLessons,
  validateTimetableModules,
} from 'utils/timetables';
import { getModuleSemesterData } from 'utils/modules';

// Actions that should not be used directly outside of thunks
export const SET_TIMETABLES = 'SET_TIMETABLES' as const;
export const SET_TIMETABLE = 'SET_TIMETABLE' as const;
export const ADD_MODULE = 'ADD_MODULE' as const;
export const SET_HIDDEN_IMPORTED = 'SET_HIDDEN_IMPORTED' as const;
export const SET_TA_IMPORTED = 'SET_TA_IMPORTED' as const;
export const Internal = {
  setTimetables(lessons: TimetableConfig, taModules: TaModulesMap, configSchema: ConfigSchema) {
    return {
      type: SET_TIMETABLES,
      payload: { lessons, taModules, configSchema },
    };
  },

  setTimetable(
    semester: Semester,
    timetable: SemTimetableConfig | undefined,
    colors?: ColorMapping,
    hiddenModules?: ModuleCode[],
    taModules?: TaModulesConfig,
  ) {
    return {
      type: SET_TIMETABLE,
      payload: { semester, timetable, colors, hiddenModules, taModules },
    };
  },

  addModule(semester: Semester, moduleCode: ModuleCode, moduleLessonConfig: ModuleLessonConfig) {
    return {
      type: ADD_MODULE,
      payload: {
        semester,
        moduleCode,
        moduleLessonConfig,
      },
    };
  },
};

export function addModule(semester: Semester, moduleCode: ModuleCode) {
  return (dispatch: Dispatch, getState: GetState) =>
    dispatch(fetchModule(moduleCode)).then(() => {
      const module: Module = getState().moduleBank.modules[moduleCode];

      if (!module) {
        dispatch(
          openNotification(`Cannot load ${moduleCode}`, {
            action: {
              text: 'Retry',
              handler: () => {
                dispatch(addModule(semester, moduleCode));
              },
            },
          }),
        );

        return;
      }

      const moduleLessonConfig = randomModuleLessonConfig(module, semester);

      dispatch(Internal.addModule(semester, moduleCode, moduleLessonConfig));
    });
}

export const REMOVE_MODULE = 'REMOVE_MODULE' as const;
export function removeModule(semester: Semester, moduleCode: ModuleCode) {
  return {
    type: REMOVE_MODULE,
    payload: {
      semester,
      moduleCode,
    },
  };
}

export const RESET_TIMETABLE = 'RESET_TIMETABLE' as const;
export function resetTimetable(semester: Semester) {
  return {
    type: RESET_TIMETABLE,
    payload: {
      semester,
    },
  };
}

export const MODIFY_LESSON = 'MODIFY_LESSON' as const;
export function modifyLesson(activeLesson: Lesson) {
  return {
    type: MODIFY_LESSON,
    payload: {
      activeLesson,
    },
  };
}

export const CHANGE_LESSON = 'CHANGE_LESSON' as const;
export function setLesson(
  semester: Semester,
  moduleCode: ModuleCode,
  lessonType: LessonType,
  lessonIndices: LessonIndex[],
) {
  return {
    type: CHANGE_LESSON,
    payload: {
      semester,
      moduleCode,
      lessonType,
      lessonIndices,
    },
  };
}

export const ADD_LESSON = 'ADD_LESSON' as const;
export function addLesson(
  semester: Semester,
  moduleCode: ModuleCode,
  lessonType: LessonType,
  lessonIndices: LessonIndex[],
) {
  return {
    type: ADD_LESSON,
    payload: {
      semester,
      moduleCode,
      lessonType,
      lessonIndices,
    },
  };
}

export const REMOVE_LESSON = 'REMOVE_LESSON' as const;
export function removeLesson(
  semester: Semester,
  moduleCode: ModuleCode,
  lessonType: LessonType,
  lessonIndices: LessonIndex[],
) {
  return {
    type: REMOVE_LESSON,
    payload: {
      semester,
      moduleCode,
      lessonType,
      lessonIndices,
    },
  };
}

export function changeLesson(
  semester: Semester,
  moduleCode: ModuleCode,
  lessonType: LessonType,
  lessonIndices: LessonIndex[],
) {
  return setLesson(semester, moduleCode, lessonType, lessonIndices);
}

export const SET_LESSON_CONFIG = 'SET_LESSON_CONFIG' as const;
export function setLessonConfig(
  semester: Semester,
  moduleCode: ModuleCode,
  lessonConfig: ModuleLessonConfig,
) {
  return {
    type: SET_LESSON_CONFIG,
    payload: {
      semester,
      moduleCode,
      lessonConfig,
    },
  };
}

export const CANCEL_MODIFY_LESSON = 'CANCEL_MODIFY_LESSON' as const;
export function cancelModifyLesson() {
  return {
    type: CANCEL_MODIFY_LESSON,
    payload: null,
  };
}

export function setTimetable(
  semester: Semester,
  timetable?: SemTimetableConfig,
  colors?: ColorMapping,
) {
  return (dispatch: Dispatch, getState: GetState) => {
    let validatedTimetable = timetable;
    if (timetable) {
      [validatedTimetable] = validateTimetableModules(timetable, getState().moduleBank.moduleCodes);
    }

    return dispatch(
      Internal.setTimetable(
        semester,
        validatedTimetable,
        colors,
        getState().timetables.hidden[semester] ?? [],
        getState().timetables.ta[semester] ?? {},
      ),
    );
  };
}

function migrateTimetableConfigs(
  lessons: TimetableConfig,
  ta: TaModulesMap,
  modules: ModulesMap,
  validConfigSchema: ConfigSchema,
  dispatch: Dispatch,
) {
  const timetableConfig: TimetableConfig = mapValues(
    lessons,
    (semTimetableConfig: SemTimetableConfig, semesterString) => {
      const semester = parseInt(semesterString, 10);
      return migrateSemTimetableConfig(semTimetableConfig, ta[semester], modules, semester);
    },
  );
  const taModulesMap: TaModulesMap = mapValues(ta, migrateTaModulesConfig);

  dispatch(Internal.setTimetables(timetableConfig, taModulesMap, validConfigSchema));

  return {
    lessons: timetableConfig,
    ta: taModulesMap,
  };
}

export function validateTimetable(semester: Semester) {
  return (dispatch: Dispatch, getState: GetState) => {
    const { timetables, moduleBank } = getState();
    const { configSchema } = timetables;

    // Migrate classNo timetable config to lessonGroup timetable config
    // Checking the config for its schema has nearly the same complexity as migrating it,
    // so the migration is made to be idempotent and to accept lesson group schema.
    // It will only run when the config schema is not lesson group
    const validConfigSchema: ConfigSchema = 'LESSON_GROUP';
    const { lessons, ta } =
      configSchema === validConfigSchema
        ? timetables
        : migrateTimetableConfigs(
            timetables.lessons,
            timetables.ta,
            moduleBank.modules,
            validConfigSchema,
            dispatch,
          );

    // Extract the timetable and the modules for the semester
    const semTimetable = lessons[semester];
    const taModules = ta[semester];

    if (!(semTimetable && taModules)) return;

    // Check that all lessons for each module are valid. If they are not, we update it
    // such that they are
    each(semTimetable, (lessonConfig: ModuleLessonConfig, moduleCode: ModuleCode) => {
      const module = moduleBank.modules[moduleCode];
      if (!module) return;

      const isTa = taModules.includes(moduleCode);

      const [validatedLessonConfig, changedLessonTypes] = validateModuleLessons(
        semester,
        lessonConfig,
        module,
        isTa,
      );

      if (changedLessonTypes.length) {
        dispatch(setLessonConfig(semester, moduleCode, validatedLessonConfig));
      }
    });
  };
}

export function fetchTimetableModules(timetables: SemTimetableConfig[]) {
  const moduleCodes = new Set(flatMap(timetables, Object.keys));
  return fetchModules(moduleCodes);
}

export function fetchModules(moduleCodes: Set<ModuleCode>) {
  return (dispatch: Dispatch, getState: GetState) => {
    const validateModule = getModuleCondensed(getState());

    return Promise.all(
      Array.from(moduleCodes)
        .filter(validateModule)
        .map((moduleCode) => dispatch(fetchModule(moduleCode))),
    );
  };
}

export function setHiddenModulesFromImport(semester: Semester, hiddenModules: ModuleCode[]) {
  return (dispatch: Dispatch) => dispatch(setHiddenImported(semester, hiddenModules));
}

export function setHiddenImported(semester: Semester, hiddenModules: ModuleCode[]) {
  return {
    type: SET_HIDDEN_IMPORTED,
    payload: { semester, hiddenModules },
  };
}

export function setTaModulesFromImport(semester: Semester, taModules: TaModulesConfig) {
  return (dispatch: Dispatch) => dispatch(setTaImported(semester, taModules));
}

export function setTaImported(semester: Semester, taModules: TaModulesConfig) {
  return {
    type: SET_TA_IMPORTED,
    payload: { semester, taModules },
  };
}

export const SELECT_MODULE_COLOR = 'SELECT_MODULE_COLOR' as const;
export function selectModuleColor(
  semester: Semester,
  moduleCode: ModuleCode,
  colorIndex: ColorIndex,
) {
  return {
    type: SELECT_MODULE_COLOR,
    payload: {
      semester,
      moduleCode,
      colorIndex,
    },
  };
}

export const HIDE_LESSON_IN_TIMETABLE = 'HIDE_LESSON_IN_TIMETABLE' as const;
export function hideLessonInTimetable(semester: Semester, moduleCode: ModuleCode) {
  return {
    type: HIDE_LESSON_IN_TIMETABLE,
    payload: { moduleCode, semester },
  };
}

export const SHOW_LESSON_IN_TIMETABLE = 'SHOW_LESSON_IN_TIMETABLE' as const;
export function showLessonInTimetable(semester: Semester, moduleCode: ModuleCode) {
  return {
    type: SHOW_LESSON_IN_TIMETABLE,
    payload: { moduleCode, semester },
  };
}

export const ADD_TA_MODULE = 'ADD_TA_MODULE' as const;
export function addTaModule(semester: Semester, moduleCode: ModuleCode) {
  return {
    type: ADD_TA_MODULE,
    payload: { semester, moduleCode },
  };
}

export const REMOVE_TA_MODULE = 'REMOVE_TA_MODULE' as const;
export function removeTaModule(semester: Semester, moduleCode: ModuleCode) {
  return {
    type: REMOVE_TA_MODULE,
    payload: { semester, moduleCode },
  };
}

export const DISABLE_TA_MODULE = 'DISABLE_TA_MODULE' as const;
export function disableTaModule(semester: Semester, moduleCode: ModuleCode) {
  return (dispatch: Dispatch, getState: GetState) => {
    const module: Module = getState().moduleBank.modules[moduleCode];
    const semesterData = getModuleSemesterData(module, semester);
    if (!semesterData) {
      dispatch(removeTaModule(semester, moduleCode));
      return;
    }
    const { groupedLessons } = semesterData;
    const timetableLessonIndices = getState().timetables.lessons[semester][moduleCode];

    // For each lesson type
    forEach(groupedLessons, (lessonsWithLessonType, lessonType) => {
      const timetableLessonsWithLessonType = timetableLessonIndices[lessonType];
      if (!isArray(timetableLessonsWithLessonType)) return;
      const lessonGroupOccurrences = entries(
        reduce(
          lessonsWithLessonType,
          (accumulated, lessonIndices, lessonGroup) => ({
            ...accumulated,
            [lessonGroup]: intersection(lessonIndices, timetableLessonsWithLessonType).length,
          }),
          {} as Record<LessonGroup, number>,
        ),
      );

      const [closestLessonGroupKey] =
        maxBy(lessonGroupOccurrences, ([, occurrences]) => occurrences) ??
        lessonGroupOccurrences[0];

      const closestLessonGroup = groupedLessons[lessonType][closestLessonGroupKey];
      dispatch(changeLesson(semester, moduleCode, lessonType, closestLessonGroup));
    });

    dispatch(removeTaModule(semester, moduleCode));
  };
}
