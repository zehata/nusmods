import * as React from 'react';
import styles from './TimetableCell.scss';
import classNames from 'classnames';
import { Minus, Plus } from 'react-feather';
import LessonRemovedWarning from 'views/components/InvalidLessons/LessonRemovedWarning';

type Props = {
  className?: string;
  onClick?: (e: React.MouseEvent<Element, MouseEvent>) => void;
  taActionIndicator?: 'plus' | 'minus';
  moduleName?: React.ReactNode;
  lessonTypeAndClassNo?: React.ReactNode;
  venue?: React.ReactNode;
  weeks?: React.ReactNode;
  colorIndex?: number;
  showWarning?: boolean;
} & React.HTMLAttributes<HTMLButtonElement> &
  React.HTMLAttributes<HTMLDivElement>;

const TimetableCell: React.FC<Props> = ({
  className,
  onClick,
  taActionIndicator,
  moduleName,
  lessonTypeAndClassNo,
  venue,
  weeks,
  colorIndex,
  showWarning,
  ...props
}: Props) => {
  const Cell = onClick ? 'button' : 'div';
  const TaActionIndicator = taActionIndicator === 'plus' ? Plus : Minus;

  const colorStyle =
    colorIndex === -1 ? styles.transparentCell : [styles.coloredCell, `color-${colorIndex}`];

  return (
    <Cell
      className={classNames(styles.baseCell, colorStyle, className)}
      onClick={onClick}
      {...props}
    >
      <div className={styles.cellContainer}>
        <div>
          <div className={styles.cellHeaader}>
            <div className={styles.moduleName}>{moduleName !== undefined && moduleName}</div>

            {taActionIndicator && <TaActionIndicator className={styles.taActionIndicator} />}
          </div>
          {lessonTypeAndClassNo !== undefined && <div>{lessonTypeAndClassNo}</div>}
          {venue !== undefined && <div>{venue}</div>}
          {weeks !== undefined && <div>{weeks}</div>}
        </div>
        <div>{showWarning && <LessonRemovedWarning className={styles.warning} />}</div>
      </div>
    </Cell>
  );
};

export default TimetableCell;
