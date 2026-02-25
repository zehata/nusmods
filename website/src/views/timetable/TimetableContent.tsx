import * as React from 'react';
import classnames from 'classnames';
import { connect } from 'react-redux';
import {
  sortBy,
  difference,
  values,
  flatten,
  isEmpty,
  filter,
  isArray,
  keys,
  omit,
  map,
  pickBy,
} from 'lodash';

import { ColorMapping, HORIZONTAL, ModulesMap, TimetableOrientation } from 'types/reducers';
import { LessonKey, LessonType, Module, ModuleCode, Semester } from 'types/modules';
import {
  SemTimetableConfig,
  SemTimetableConfigWithLessons,
  InteractableLesson,
  TaModulesConfigV1,
  Lesson,
} from 'types/timetables';

import {
  addModule,
  cancelModifyLesson,
  changeLesson,
  addLesson,
  removeLesson,
  modifyLesson,
  removeModule,
  resetTimetable,
} from 'actions/timetables';
import { formatExamDate, getExamDate } from 'utils/modules';
import {
  arrangeLessonsForWeek,
  findExamClashes,
  getInteractableLessons,
  getLessonIdentifier,
  getSemesterModules,
  hydrateSemTimetableWithLessons,
  serializeLessonDetails,
  timetableLessonsArray,
} from 'utils/timetables';
import { resetScrollPosition } from 'utils/react';
import ModulesSelectContainer from 'views/timetable/ModulesSelectContainer';
import Announcements from 'views/components/notfications/Announcements';
import Title from 'views/components/Title';
import ErrorBoundary from 'views/errors/ErrorBoundary';
import ModRegNotification from 'views/components/notfications/ModRegNotification';
import { State as StoreState } from 'types/state';
import { ModuleWithColor, TombstoneModule } from 'types/views';
import Timetable from './Timetable';
import TimetableActions from './TimetableActions';
import TimetableModulesTable from './TimetableModulesTable';
import ExamCalendar from './ExamCalendar';
import ModulesTableFooter from './ModulesTableFooter';
import styles from './TimetableContent.scss';

type ModifiedCell = {
  className: string;
  position: ClientRect;
};

type OwnProps = {
  // Own props
  readOnly: boolean;
  header: React.ReactNode;
  semester: Semester;
  timetable: SemTimetableConfig;
  colors: ColorMapping;
  hiddenImportedModules: ModuleCode[] | null;
  taImportedModules: ModuleCode[] | TaModulesConfigV1 | null;
};

type Props = OwnProps & {
  // From Redux
  timetableWithLessons: SemTimetableConfigWithLessons<Lesson>;
  modules: ModulesMap;
  activeLesson: Lesson | null;
  timetableOrientation: TimetableOrientation;
  showTitle: boolean;
  hiddenInTimetable: ModuleCode[];
  taInTimetable: ModuleCode[];

  // Actions
  addModule: (semester: Semester, moduleCode: ModuleCode) => void;
  removeModule: (semester: Semester, moduleCode: ModuleCode) => void;
  resetTimetable: (semester: Semester) => void;
  modifyLesson: (lesson: Lesson) => void;
  addLesson: (
    semester: Semester,
    moduleCode: ModuleCode,
    lessonType: LessonType,
    lessonIndices: LessonKey[],
  ) => void;
  removeLesson: (
    semester: Semester,
    moduleCode: ModuleCode,
    lessonType: LessonType,
    lessonIndices: LessonKey[],
  ) => void;
  changeLesson: (
    semester: Semester,
    moduleCode: ModuleCode,
    lessonType: LessonType,
    lessonIndices: LessonKey[],
  ) => void;
  cancelModifyLesson: () => void;
};

/**
 * When a module is modified, we want to ensure the selected timetable cell
 * is in approximately the same location when all of the new options are rendered.
 * This is important for modules with a lot of options which can push the selected
 * option off screen and disorientate the user.
 */
function maintainScrollPosition(container: HTMLElement, modifiedCell: ModifiedCell) {
  const newCell = container.getElementsByClassName(modifiedCell.className)[0];
  if (!newCell) return;

  const previousPosition = modifiedCell.position;
  const currentPosition = newCell.getBoundingClientRect();

  // We try to ensure the cell is in the same position on screen, so we calculate
  // the new position by taking the difference between the two positions and
  // adding it to the scroll position of the scroll container, which is the
  // window for the y axis and the timetable container for the x axis
  const x = currentPosition.left - previousPosition.left + window.scrollX;
  const y = currentPosition.top - previousPosition.top + window.scrollY;

  window.scroll(0, y);
  container.scrollLeft = x; // eslint-disable-line no-param-reassign
}

const FunctionalTimetableContent: React.FC<Props> = ({
  // Own props
  readOnly,
  header,
  semester,
  timetable,
  colors,

  // From Redux
  timetableWithLessons,
  modules,
  activeLesson,
  timetableOrientation,
  showTitle,
  hiddenInTimetable,
  taInTimetable,

  
  // Actions
  addModule,
  removeModule,
  resetTimetable,
  modifyLesson,
  addLesson,
  removeLesson,
  changeLesson,
  cancelModifyLesson,
}) => {
  const [isScrolledHorizontally, setScrolledHorizontally] = React.useState<boolean>(false);
  const [showExamCalendar, setShowExamCalendar] = React.useState<boolean>(false);
  const [tombstone, setTombstone] = React.useState<TombstoneModule | null>(null);

  const timetableRef = React.createRef<HTMLDivElement>();
  const [modifiedCell, setModifiedCell] = React.useState<ModifiedCell | null>(null);

  React.useEffect(() => {
    if (modifiedCell && timetableRef.current) {
      maintainScrollPosition(timetableRef.current, modifiedCell);
      setModifiedCell(null);
    }
  }, [modifiedCell, timetableRef]);

  const onScroll = React.useCallback(
    (e: React.UIEvent) => {
      // Only trigger when there is an active lesson
      setScrolledHorizontally(!!activeLesson && e.currentTarget && e.currentTarget.scrollLeft > 0);
    },
    [activeLesson],
  );

  const cancelModifyAndResetScroll = React.useCallback((): void => {
    if (!activeLesson) {
      return;
    }
    cancelModifyLesson();
    resetScrollPosition();
  }, [activeLesson]);

  const modifyTaCell = React.useCallback(
    (
      sameLessonTypeLessons: Record<LessonKey, InteractableLesson>,
      interactableLesson: InteractableLesson,
    ) => {
      const { moduleCode, lessonType } = interactableLesson;
      const lessonKey = serializeLessonDetails(interactableLesson);

      const currentlySelected = filter(
        sameLessonTypeLessons,
        (lesson) => !lesson.canBeAddedToLessonConfig,
      );
      if (interactableLesson.canBeAddedToLessonConfig) {
        // Allow multiple lessons of the same type to be added for TA lessons
        addLesson(semester, moduleCode, lessonType, [lessonKey]);
      } else if (currentlySelected.length > 1) {
        // If a TA lesson is the last of its type, disallow removing it
        removeLesson(semester, moduleCode, lessonType, [lessonKey]);
      } else {
        cancelModifyLesson();
      }
      resetScrollPosition();

      return () => cancelModifyAndResetScroll();
    },
    [cancelModifyAndResetScroll, semester],
  );

  const isTaInTimetable = React.useCallback(
    (moduleCode: ModuleCode) => taInTimetable.includes(moduleCode),
    [taInTimetable],
  );
  const isHiddenInTimetable = React.useCallback(
    (moduleCode: ModuleCode) => hiddenInTimetable.includes(moduleCode),
    [hiddenInTimetable],
  );

  const timetableLessons = omit(timetableWithLessons, hiddenInTimetable);

  const interactableLessonsMap = React.useMemo(
    () =>
      getInteractableLessons(
        timetableLessons,
        taInTimetable,
        modules,
        semester,
        colors,
        readOnly,
        activeLesson,
      ),
    [timetableLessons, taInTimetable, modules, semester, colors, readOnly, activeLesson],
  );
  const interactableLessons: InteractableLesson[] = timetableLessonsArray(interactableLessonsMap);
  const arrangedLessons = arrangeLessonsForWeek(interactableLessons);

  const modifyCell = React.useCallback(
    (lesson: InteractableLesson, position: ClientRect): void => {
      const lessonMap = interactableLessonsMap[lesson.moduleCode];

      // If activeLesson exists, then the user is choosing a cell to modify
      const isChoosing = !!activeLesson;
      if (isChoosing) {
        const sameLessonTypeLessons = lessonMap[activeLesson.lessonType];

        if (isTaInTimetable(lesson.moduleCode)) {
          modifyTaCell(sameLessonTypeLessons, lesson);
          return;
        }

        if (lesson.canBeAddedToLessonConfig) {
          const lessonKeys = keys(pickBy(sameLessonTypeLessons, sameLessonTypeLesson => sameLessonTypeLesson.classNo === lesson.classNo));
          changeLesson(semester, lesson.moduleCode, lesson.lessonType, lessonKeys);
        } else {
          cancelModifyLesson();
        }
        resetScrollPosition();
      } else {
        modifyLesson(lesson);

        setModifiedCell({
          position,
          className: getLessonIdentifier(lesson),
        });
      }
    },
    [interactableLessonsMap, activeLesson, isTaInTimetable, modifyTaCell, semester],
  );

  const addSemesterModule = React.useCallback(
    (moduleCode: ModuleCode) => {
      addModule(semester, moduleCode);
      setTombstone(null);
    },
    [semester],
  );

  // Returns modules currently in the timetable
  const addedModules = React.useMemo((): Module[] => {
    const semesterModules = getSemesterModules(timetableWithLessons, modules);
    return sortBy(semesterModules, (module: Module) => getExamDate(module, semester));
  }, [modules, semester, timetableWithLessons]);

  const toModuleWithColor = React.useCallback(
    (module: Module): ModuleWithColor => ({
      ...module,
      colorIndex: colors[module.moduleCode],
      isHiddenInTimetable: isHiddenInTimetable(module.moduleCode),
      isTaInTimetable: isTaInTimetable(module.moduleCode),
    }),
    [colors, isHiddenInTimetable, isTaInTimetable],
  );

  const removeModuleAndSetTombstone = React.useCallback(
    (moduleCodeToRemove: ModuleCode) => {
      // Save the index of the module before removal so the tombstone can be inserted into
      // the correct position
      const index = addedModules.findIndex(({ moduleCode }) => moduleCode === moduleCodeToRemove);
      removeModule(semester, moduleCodeToRemove);
      const moduleWithColor = toModuleWithColor(addedModules[index]);

      // A tombstone is displayed in place of a deleted module
      setTombstone({ ...moduleWithColor, index });
    },
    [addedModules, semester, toModuleWithColor],
  );

  const resetSemesterTimetable = React.useCallback(() => resetTimetable(semester), [semester]);

  const isVerticalOrientation = React.useMemo(
    () => timetableOrientation !== HORIZONTAL,
    [timetableOrientation],
  );
  const isShowingTitle = React.useMemo(
    () => !isVerticalOrientation && showTitle,
    [isVerticalOrientation, showTitle],
  );

  // Separate added modules into sections of clashing modules.
  // Note: exclude hidden courses and TA-ed courses from exam clash detection.
  const examinableModules = React.useMemo(
    () =>
      filter(
        addedModules,
        (module) => !isHiddenInTimetable(module.moduleCode) && !isTaInTimetable(module.moduleCode),
      ),
    [addedModules, isHiddenInTimetable, isTaInTimetable],
  );

  const clashes = React.useMemo(
    () => findExamClashes(examinableModules, semester),
    [examinableModules, semester],
  );

  const nonClashingMods: Module[] = React.useMemo(
    () => difference(addedModules, flatten(values(clashes))),
    [addedModules, clashes],
  );

  return (
    <div
      className={classnames('page-container', styles.container, {
        verticalMode: isVerticalOrientation,
      })}
      onClick={cancelModifyAndResetScroll}
      onKeyUp={(e) => e.key === 'Escape' && cancelModifyAndResetScroll()} // Quit modifying when Esc is pressed
      data-testid="timetable"
    >
      <Title>Timetable</Title>

      <Announcements />

      <ErrorBoundary>
        <ModRegNotification />
      </ErrorBoundary>

      <div>{header}</div>

      <div className="row">
        <div
          className={classnames({
            'col-md-12': !isVerticalOrientation,
            'col-md-8': isVerticalOrientation,
          })}
        >
          {showExamCalendar ? (
            <ExamCalendar
              semester={semester}
              modules={addedModules.map((module) => ({
                ...module,
                colorIndex: colors[module.moduleCode],
                isHiddenInTimetable: isHiddenInTimetable(module.moduleCode),
                isTaInTimetable: isTaInTimetable(module.moduleCode),
              }))}
            />
          ) : (
            <div className={styles.timetableWrapper} onScroll={onScroll} ref={timetableRef}>
              <Timetable
                lessons={arrangedLessons}
                isVerticalOrientation={isVerticalOrientation}
                isScrolledHorizontally={isScrolledHorizontally}
                showTitle={isShowingTitle}
                onModifyCell={modifyCell}
              />
            </div>
          )}
        </div>
        <div
          className={classnames({
            'col-md-12': !isVerticalOrientation,
            'col-md-4': isVerticalOrientation,
          })}
        >
          <div className="row">
            <div className="col-12 no-export">
              <TimetableActions
                isVerticalOrientation={isVerticalOrientation}
                showTitle={isShowingTitle}
                semester={semester}
                timetable={timetable}
                showExamCalendar={showExamCalendar}
                resetTimetable={resetSemesterTimetable}
                toggleExamCalendar={() => setShowExamCalendar(!showExamCalendar)}
                hiddenModules={hiddenInTimetable}
                taModules={taInTimetable}
              />
            </div>

            <div className={styles.modulesSelect}>
              {!readOnly && (
                <ModulesSelectContainer
                  semester={semester}
                  timetable={timetable}
                  addModule={addSemesterModule}
                  removeModule={removeModuleAndSetTombstone}
                />
              )}
            </div>

            <div className="col-12">
              {isEmpty(clashes) && isEmpty(nonClashingMods) && !tombstone ? (
                <div className="row">
                  <div className="col-sm-12">
                    <p className="text-sm-center">No courses added.</p>
                  </div>
                </div>
              ) : (
                <>
                  {!isEmpty(clashes) && (
                    <>
                      <div className="alert alert-danger">
                        Warning! There are clashes in your exam timetable.
                      </div>
                      {Object.keys(clashes)
                        .sort()
                        .map((clashDate) => (
                          <div key={clashDate}>
                            <p>
                              Clash on <strong>{formatExamDate(clashDate)}</strong>
                            </p>
                            <TimetableModulesTable
                              modules={map(clashes[clashDate], toModuleWithColor)}
                              horizontalOrientation={!isVerticalOrientation}
                              semester={semester}
                              onRemoveModule={removeModuleAndSetTombstone}
                              readOnly={readOnly}
                              tombstone={null}
                              resetTombstone={() => setTombstone(null)}
                            />
                          </div>
                        ))}
                      <hr />
                    </>
                  )}
                  <TimetableModulesTable
                    modules={map(nonClashingMods, toModuleWithColor)}
                    horizontalOrientation={!isVerticalOrientation}
                    semester={semester}
                    onRemoveModule={removeModuleAndSetTombstone}
                    readOnly={readOnly}
                    tombstone={tombstone}
                    resetTombstone={() => setTombstone(null)}
                  />
                </>
              )}
            </div>
            <div className="col-12">
              <ModulesTableFooter
                modules={addedModules}
                semester={semester}
                hiddenInTimetable={hiddenInTimetable}
                taInTimetable={taInTimetable}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

function mapStateToProps(state: StoreState, ownProps: OwnProps) {
  const { semester, timetable } = ownProps;
  const { modules } = state.moduleBank;

  const hiddenInTimetable =
    ownProps.hiddenImportedModules ?? state.timetables.hidden[semester] ?? [];
  const taInTimetable = ownProps.taImportedModules ?? state.timetables.ta[semester] ?? [];
  const taModuleCodes: ModuleCode[] = isArray(taInTimetable) ? taInTimetable : keys(taInTimetable);

  const timetableWithLessons: SemTimetableConfigWithLessons<Lesson> =
    hydrateSemTimetableWithLessons(timetable, modules, semester);

  return {
    semester,
    timetable,
    timetableWithLessons,
    modules,
    activeLesson: state.app.activeLesson,
    timetableOrientation: state.theme.timetableOrientation,
    showTitle: state.theme.showTitle,
    hiddenInTimetable,
    taInTimetable: taModuleCodes,
  };
}

export default connect(mapStateToProps, {
  addModule,
  removeModule,
  resetTimetable,
  modifyLesson,
  changeLesson,
  addLesson,
  removeLesson,
  cancelModifyLesson,
})(FunctionalTimetableContent);
