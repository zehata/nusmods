import { AlertTriangle } from 'react-feather';
import styles from './LessonRemovedWarning.scss';
import React from 'react';
import classNames from 'classnames';

type Props = {
  className?: string;
};

const LessonRemovedWarning: React.FC<Props> = ({ className, ...props }) => {
  return (
    <div className={classNames(styles.warning, className)} {...props}>
      <AlertTriangle />
      {'This lesson has been removed'}
    </div>
  );
};

export default LessonRemovedWarning;
