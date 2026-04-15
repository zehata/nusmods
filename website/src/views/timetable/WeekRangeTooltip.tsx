import * as React from 'react';
import classnames from 'classnames';
import { addWeeks, format, parseISO } from 'date-fns';
import NUSModerator, { AcadWeekInfo } from 'nusmoderator';

import { WeekRange } from 'types/modules';
import Tooltip from 'views/components/Tooltip/Tooltip';
import styles from './TimetableCell.scss';

type Props = {
  weekRange: WeekRange;
};

const lessonDateFormat = 'MMM dd';

function formatWeekInfo(weekInfo: AcadWeekInfo) {
  if (weekInfo.type === 'Instructional') return `Week ${weekInfo.num}`;
  return weekInfo.type;
}

const WeekRangeTooltip: React.FC<Props> = ({ weekRange }) => {
  const start = parseISO(weekRange.start);

  // Start = end means there's just one lesson
  if (weekRange.start === weekRange.end) return format(start, lessonDateFormat);

  let dateRange = `${format(start, lessonDateFormat)}–${format(
    parseISO(weekRange.end),
    lessonDateFormat,
  )}`;

  // If lessons are not weekly, we need to mention that
  if (weekRange.weekInterval) {
    dateRange += `, every ${weekRange.weekInterval} weeks`;
  }

  if (!weekRange.weeks) return dateRange;

  // If the weeks are uneven (ie. there are gaps), we need to use a full table
  // to show all the dates the lesson is on
  const table = (
    <div className={styles.classes}>
      <h5>Classes</h5>
      <ol className={classnames({ [styles.twoColumn]: weekRange.weeks.length > 6 })}>
        {weekRange.weeks.map((week) => {
          const date = addWeeks(start, week - 1);
          const weekInfo = NUSModerator.academicCalendar.getAcadWeekInfo(date);
          return (
            <li key={week}>
              {format(date, lessonDateFormat)}{' '}
              <span className={styles.weekInfo}>({formatWeekInfo(weekInfo)})</span>
            </li>
          );
        })}
      </ol>
    </div>
  );

  return (
    <Tooltip content={table} interactive arrow>
      <span className={styles.weeksSpecial}>{dateRange}</span>
    </Tooltip>
  );
};

export default WeekRangeTooltip;
