import React, { HTMLAttributes } from 'react';
import { isWeekRange, LessonType, ModuleCode, RawLesson } from 'types/modules';
import { ColorIndex, LessonModification } from 'types/timetables';
import { formatNumericWeeks, lessonTypeAbbrev } from 'utils/timetables';
import TimetableCell from 'views/timetable/TimetableCell';
import WeekRangeTooltip from 'views/timetable/WeekRangeTooltip';
import styles from './LessonModificationViewer.scss';
import classNames from 'classnames';
import { isEqual } from 'lodash-es';

type Props = {
  className?: string;
  lessonTypeAbbrev: lessonTypeAbbrev[keyof lessonTypeAbbrev];
  modification: LessonModification;
  colorIndex: ColorIndex;
} & HTMLAttributes<Element>;

const LessonFieldComparison: React.FC<{
  before?: React.ReactNode;
  after?: React.ReactNode;
}> = ({ before, after }) => {
  if (before === undefined && after === undefined) return <></>;

  return (
    <span className={styles.lessonFieldComparison}>
      {before && (
        <span className={classNames(styles.strikethrough, { [styles.before]: after })}>
          {before}
        </span>
      )}
      {after && <span className={classNames({ [styles.after]: before })}>{after}</span>}
    </span>
  );
};

const LessonModificationViewer: React.FC<Props> = ({
  className,
  lessonTypeAbbrev,
  modification,
  colorIndex,
  ...props
}) => {
  const lessonBefore = modification.before;
  const lessonAfter = modification.after;

  const header = React.useMemo(() => {
    if (modification.before && modification.after) return 'Lesson Changed';

    if (modification.before) return 'Lesson Removed';

    return 'Lesson Added';
  }, [modification]);

  const constructWeeks = React.useCallback((lesson: RawLesson | null) => {
    if (!lesson) return '';

    if (!isWeekRange(lesson.weeks)) return formatNumericWeeks(lesson.weeks) ?? '';

    return <WeekRangeTooltip weekRange={lesson.weeks} />;
  }, []);

  const { classNoBefore, venueBefore, classNoAfter, venueAfter } = React.useMemo(() => {
    return {
      classNoBefore: lessonBefore?.classNo ?? '',
      venueBefore: lessonBefore?.venue ?? '',
      classNoAfter: lessonAfter?.classNo ?? '',
      venueAfter: lessonAfter?.venue ?? '',
    };
  }, [lessonBefore, lessonAfter]);
  const weeksBefore = React.useMemo(() => constructWeeks(lessonBefore), [lessonBefore]);
  const weeksAfter = React.useMemo(() => constructWeeks(lessonAfter), [lessonAfter]);

  return (
    <TimetableCell
      className={className}
      moduleName={<span>{header}</span>}
      lessonTypeAndClassNo={
        <>
          <span className={classNames({ [styles.strikethrough]: lessonBefore && !lessonAfter })}>
            {lessonTypeAbbrev}{' '}
          </span>
          <LessonFieldComparison
            before={classNoBefore !== classNoAfter && classNoBefore && `[${classNoBefore}]`}
            after={classNoAfter && `[${classNoAfter}]`}
          ></LessonFieldComparison>
        </>
      }
      venue={
        <LessonFieldComparison
          before={venueBefore !== venueAfter && venueBefore}
          after={venueAfter}
        ></LessonFieldComparison>
      }
      weeks={
        <LessonFieldComparison
          before={!isEqual(lessonBefore?.weeks, lessonAfter?.weeks) && weeksBefore}
          after={weeksAfter}
        ></LessonFieldComparison>
      }
      colorIndex={colorIndex}
      {...props}
    />
  );
};

export default LessonModificationViewer;
