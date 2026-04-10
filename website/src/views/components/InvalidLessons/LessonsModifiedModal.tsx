import React from 'react';
import CloseButton from '../CloseButton';
import Modal from '../Modal';
import type { Semester, ModuleCode, LessonType, LessonKey } from 'types/modules';
import { map, noop } from 'lodash-es';
import { deserializeLessonDetails } from 'utils/timetables';
import TimetableCell from 'views/timetable/TimetableCell';
import styles from './LessonsModifiedModal.scss';
import classNames from 'classnames';
import { ArrowRight } from 'react-feather';
import { State } from 'types/state';
import { connect } from 'react-redux';

type Props = {
  className?: string;
};

const LessonsModifiedModal: React.FC<Props> = ({ className }) => {
  const [lessonsModifiedModalOpen, setLessonsModifiedModalOpen] = React.useState<boolean>(false);

  return (
    <Modal className={classNames(className)} isOpen={lessonsModifiedModalOpen}>
      <CloseButton absolutePositioned onClick={() => setLessonsModifiedModalOpen(false)} />
      <h3>{`Modified Lessons`}</h3>
      <div className={styles.wrapper}>
        {map(semesterLessonModifications, (semesterModifications, semester) => (
          <div key={semester} className={styles.semesterModifications}>
            {`Semester ${semester}`}
            <hr />
            {map(semesterModifications, (moduleModifications, moduleCode) => (
              <div key={moduleCode} className={styles.moduleModifications}>
                {map(moduleModifications, (lessonTypeModification, lessonType) => (
                  <div className={styles.lessonTypeModifications}>
                    <div className={styles.originalLessons}>
                      {map(lessonTypeModification.original, (originalLessonKey) => {
                        const lesson = deserializeLessonDetails(originalLessonKey);
                        return (
                          <div>
                            {lesson.day}
                            <div className={styles.lessonTiming}>
                              <div>{lesson.startTime}</div>
                              <div>{lesson.endTime}</div>
                            </div>
                            <TimetableCell
                              showTitle={true}
                              lesson={{
                                ...lesson,
                                lessonType,
                                moduleCode,
                                title: '',
                                colorIndex: 0,
                              }}
                              onHover={noop}
                              transparent={false}
                            ></TimetableCell>
                          </div>
                        );
                      })}
                    </div>
                    <ArrowRight />
                    <div className={styles.modifiedLessons}>
                      {map(lessonTypeModification.modified, (modifiedLessonKey) => {
                        const lesson = deserializeLessonDetails(modifiedLessonKey);
                        return (
                          <div>
                            {lesson.day}
                            <div className={styles.lessonTiming}>
                              <div>{lesson.startTime}</div>
                              <div>{lesson.endTime}</div>
                            </div>
                            <TimetableCell
                              showTitle={true}
                              lesson={{
                                ...lesson,
                                lessonType,
                                moduleCode,
                                title: '',
                                colorIndex: 0,
                              }}
                              onHover={noop}
                              transparent={false}
                            ></TimetableCell>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  );
};

const mapStateToProps = (state: State) => {
  const { lessonsChangedNotifications } = state.timetables;

  return {
    lessonsChangedNotifications,
  };
};

export default connect(mapStateToProps)(LessonsModifiedModal);
