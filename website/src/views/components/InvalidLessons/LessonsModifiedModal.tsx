import React from 'react';
import CloseButton from '../CloseButton';
import Modal from '../Modal';
import { flatMap, get, isEmpty, map, size } from 'lodash-es';
import styles from './LessonsModifiedModal.scss';
import classNames from 'classnames';
import { State } from 'types/state';
import { connect, useDispatch } from 'react-redux';
import { ColorMapping, ModulesMap, SemesterLessonsChangedNotificationsMap } from 'types/reducers';
import { openNotification } from 'actions/app';
import LessonModificationViewer from './LessonModificationViewer';
import { LESSON_TYPE_ABBREV } from 'utils/timetables';
import { getModuleCondensed, ModuleCondensedGetter } from 'selectors/moduleBank';
import { getSemesterTimetableColors } from 'selectors/timetables';
import { Semester } from 'types/modules';

type Props = {
  className?: string;
  getModuleCondensed: ModuleCondensedGetter;
  getSemesterTimetableColors: (semester: Semester) => ColorMapping;
  semesterLessonsChangedNotificationsMap: SemesterLessonsChangedNotificationsMap;
};

const LessonsModifiedModal: React.FC<Props> = ({
  className,
  getModuleCondensed,
  getSemesterTimetableColors,
  semesterLessonsChangedNotificationsMap,
}) => {
  const dispatch = useDispatch();
  const [lessonsModifiedModalOpen, setLessonsModifiedModalOpen] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (lessonsModifiedModalOpen || flatMap(semesterLessonsChangedNotificationsMap).length < 1)
      return;

    dispatch(
      openNotification('Some lessons have changed', {
        timeout: 10000,
        action: {
          text: 'View',
          handler: () => setLessonsModifiedModalOpen(true),
        },
      }),
    );
  }, [semesterLessonsChangedNotificationsMap]);

  return (
    <Modal className={classNames(className)} isOpen={lessonsModifiedModalOpen} animate>
      <CloseButton absolutePositioned onClick={() => setLessonsModifiedModalOpen(false)} />
      <h4>{`Modified Lessons`}</h4>
      <div className={styles.wrapper}>
        {map(semesterLessonsChangedNotificationsMap, (semesterModifications, semester) => {
          const colorMapping = getSemesterTimetableColors(parseInt(semester, 10));

          return (
            <div key={semester}>
              {size(semesterLessonsChangedNotificationsMap) > 1 && <h3>Semester {semester}</h3>}
              <hr />
              {map(semesterModifications, ({ moduleCode, modifications }) => {
                const condensedModule = getModuleCondensed(moduleCode);
                const colorIndex = get(colorMapping, moduleCode);

                return (
                  <div key={moduleCode} className={styles.moduleModifications}>
                    <div
                      className={styles.moduleTitle}
                    >{`${condensedModule?.moduleCode} ${condensedModule?.title}`}</div>
                    {map(modifications, (modifications, lessonType) => (
                      <div key={lessonType} className="row">
                        <div className="col-md-3">{lessonType}</div>
                        <div className={classNames('col-md-6', styles.lessonTypeModifications)}>
                          {map(modifications, (modification, notificationIndex) => (
                            <LessonModificationViewer
                              key={notificationIndex}
                              lessonTypeAbbrev={LESSON_TYPE_ABBREV[lessonType]}
                              modification={modification}
                              colorIndex={colorIndex}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </Modal>
  );
};

const mapStateToProps = (state: State) => {
  const { lessonsChangedNotifications: semesterLessonsChangedNotificationsMap } = state.timetables;

  return {
    getModuleCondensed: getModuleCondensed(state),
    getSemesterTimetableColors: getSemesterTimetableColors(state),
    semesterLessonsChangedNotificationsMap,
  };
};

export default connect(mapStateToProps)(LessonsModifiedModal);
