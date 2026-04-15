import classnames from 'classnames';
import { Heart, Info } from 'react-feather';

import styles from './Announcements.scss';
import React from 'react';
import CloseButton from '../CloseButton';

type Props = {
  children?: React.ReactNode;
  icon?: 'heart' | 'info';
  dismissAction?: () => void;
};

const Announcements: React.FC<Props> = ({ children, icon, dismissAction }) => {
  const BackgroundIcon = React.useMemo(() => {
    if (!icon) return;

    switch (icon) {
      case 'heart':
        return Heart;
      case 'info':
        return Info;
    }
  }, [icon]);

  return (
    <div
      className={classnames(
        'alert alert-success no-export',
        styles.announcement,
        // styles.wrapButtons, // Uncomment if needed
      )}
    >
      {BackgroundIcon && <BackgroundIcon className={styles.backgroundIcon} />}

      <div className={styles.body}>{children}</div>

      {dismissAction && (
        <div className={styles.buttons}>
          <div className={styles.buttons}>
            <CloseButton onClick={dismissAction} />
          </div>
        </div>
      )}
    </div>
  );
};

export default Announcements;
