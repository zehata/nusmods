import React from 'react';
import CloseButton from '../CloseButton';
import Modal from '../Modal';
import { get, isEmpty, map, size } from 'lodash-es';
import styles from './LessonsModifiedAnnouncements.scss';
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
import Announcements from '../notfications/Announcements';
import { dismissLessonsChangedNotification } from 'actions/timetables';
import { LessonsChangedNotification } from 'types/timetables';

type Props = {
  getModuleCondensed: ModuleCondensedGetter;
  getSemesterTimetableColors: (semester: Semester) => ColorMapping;
  semesterLessonsChangedNotificationsMap: SemesterLessonsChangedNotificationsMap;
};

const LessonsModifiedModal: React.FC<Props> = ({
  getModuleCondensed,
  getSemesterTimetableColors,
  semesterLessonsChangedNotificationsMap,
}) => {
  const dispatch = useDispatch();
  const dismissNotification = React.useCallback(
    (semester: Semester, notification: LessonsChangedNotification) => {
      dispatch(dismissLessonsChangedNotification(semester, notification));
    },
    [dispatch],
  );

  return map(semesterLessonsChangedNotificationsMap, (semesterModifications, semesterString) => {
    const semester = parseInt(semesterString, 10);
    const colorMapping = getSemesterTimetableColors(semester);

    return map(semesterModifications, (lessonChangedNotification) => {
      const { moduleCode, modifications } = lessonChangedNotification;
      const condensedModule = getModuleCondensed(moduleCode);
      const colorIndex = get(colorMapping, moduleCode);

      return (
        <Announcements
          key={moduleCode}
          icon="info"
          dismissAction={() => dismissNotification(semester, lessonChangedNotification)}
        >
          <h3>Faculty has modified some lessons</h3>
          <div
            className={styles.moduleTitle}
          >{`${condensedModule?.moduleCode} ${condensedModule?.title}`}</div>
          <div className={styles.moduleModifications}>
            {map(modifications, (modifications, lessonType) => (
              <div key={lessonType}>
                <div className={styles.lessonType}>{lessonType}</div>
                <div className={styles.lessonTypeModifications}>
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
        </Announcements>
      );
    });
  });
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
