import { get, isUndefined, mapValues, omit } from 'lodash-es';
import { rawGetItem } from 'storage';
import { captureException } from 'utils/error';

export const getRememberPersistValue = (key: string): string | null => {
  // key = @@remember-moduleBank
  const baseKey = get(key.match(/(?<=@@remember-)(.*)/), 0);
  if (isUndefined(baseKey)) return null;
  // baseKey = moduleBank
  return rawGetItem(`persist:${baseKey}`);
};

export const migratePersistToRemember = (persistValue: string): any => {
  try {
    const parsedValue = JSON.parse(persistValue);
    const data = omit(parsedValue, '_persist');
    return mapValues(data, JSON.parse);
  } catch (error) {
    captureException(error);
    return null;
  }
};
