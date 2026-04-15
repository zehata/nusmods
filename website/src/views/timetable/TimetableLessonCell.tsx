import * as React from 'react';
import classnames from 'classnames';

import { isWeekRange } from 'types/modules';
import { ColoredLesson, HoverLesson } from 'types/timetables';
import { OnHoverCell } from 'types/views';

import {
  formatNumericWeeks,
  getHoverLesson,
  getLessonIdentifier,
  isInteractable,
  LESSON_TYPE_ABBREV,
} from 'utils/timetables';
import { TRANSPARENT_COLOR_INDEX } from 'utils/colors';
import elements from 'views/elements';
import styles from './TimetableCell.scss';
import TimetableCell from './TimetableCell';
import WeekRangeTooltip from './WeekRangeTooltip';

type Props = {
  showTitle: boolean;
  lesson: ColoredLesson;
  onHover: OnHoverCell;
  style?: React.CSSProperties;
  onClick?: (position: ClientRect) => void;
  hoverLesson?: HoverLesson | null;
  transparent: boolean;
};

/**
 * Determines if the lesson should be highlighted as part of the same lesson group as the lesson currently being hovered over
 * @param lesson This cell's lesson
 * @param hoverLesson The lesson being hovered over
 */
function checkHover(lesson: ColoredLesson, hoverLesson: HoverLesson | null | undefined): boolean {
  if (!hoverLesson) return false;

  if (!isInteractable(lesson)) return false;

  if (lesson.moduleCode !== hoverLesson.moduleCode || lesson.lessonType !== hoverLesson.lessonType)
    return false;

  if (!lesson.isTaInTimetable && lesson.classNo === hoverLesson.classNo) return true;

  if (lesson.isTaInTimetable && lesson.lessonKey === hoverLesson.lessonKey) return true;

  return false;
}

/**
 * Smallest unit in timetable.
 * Representing a lesson in this case. In future we
 * might explore other representations e.g. grouped lessons
 */
const TimetableLessonCell: React.FC<Props> = (props) => {
  const { lesson, showTitle, onClick, onHover, hoverLesson, transparent } = props;

  const moduleName = showTitle ? `${lesson.moduleCode} ${lesson.title}` : lesson.moduleCode;
  const isHoveredOver = checkHover(lesson, hoverLesson);

  const conditionalProps = onClick
    ? {
        onClick: (e: React.MouseEvent) => {
          e.preventDefault();
          onClick(e.currentTarget.getBoundingClientRect());
        },
      }
    : {};

  const weeks = isWeekRange(lesson.weeks) ? (
    <WeekRangeTooltip weekRange={lesson.weeks} />
  ) : (
    formatNumericWeeks(lesson.weeks)
  );

  const lessonInvalid = 'valid' in lesson && !lesson.valid;

  const className = classnames(styles.baseCell, getLessonIdentifier(lesson), elements.lessons, {
    hoverable: !!onClick,
    lessonInvalid,
    [styles.clickable]: !!onClick,
    [styles.available]: isInteractable(lesson) && lesson.canBeAddedToLessonConfig,
    [styles.active]: isInteractable(lesson) && lesson.isActive,
    // Local hover style for the timetable planner timetable,
    [styles.hover]: isHoveredOver,
    // Global hover style for module page timetable
    hover: isHoveredOver,
  });

  const onEnter = React.useCallback(() => {
    if (isInteractable(lesson)) onHover(getHoverLesson(lesson));
  }, [lesson, onHover]);

  const taActionIndicator = React.useMemo(() => {
    if (
      !isInteractable(lesson) ||
      !lesson.isTaInTimetable ||
      !onClick ||
      !isHoveredOver ||
      !hoverLesson
    )
      return;

    if (lesson.isActive || !lesson.canBeAddedToLessonConfig) {
      return 'minus';
    }

    return 'plus';
  }, []);

  const lessonType = React.useMemo(() => LESSON_TYPE_ABBREV[lesson.lessonType], []);
  const classNo = React.useMemo(() => lesson.classNo, []);

  return (
    <TimetableCell
      className={className}
      style={props.style}
      onMouseEnter={onEnter}
      onTouchStart={onEnter}
      onMouseLeave={() => onHover(null)}
      onTouchEnd={() => onHover(null)}
      autoFocus={isInteractable(lesson) && lesson.isActive}
      moduleName={`${moduleName} ${(isInteractable(lesson) && lesson.isTaInTimetable && '(TA)') || ''}`}
      taActionIndicator={taActionIndicator}
      lessonTypeAndClassNo={
        (lessonType || classNo) && (
          <div>
            {lessonType} [{classNo}]
          </div>
        )
      }
      venue={lesson.venue.startsWith('E-Learn') ? 'E-Learning' : lesson.venue}
      weeks={weeks}
      colorIndex={transparent ? TRANSPARENT_COLOR_INDEX : lesson.colorIndex}
      showWarning={lessonInvalid}
      {...conditionalProps}
    />
  );
};

export default TimetableLessonCell;
