import { isString } from 'lodash-es';
import { captureException } from 'utils/error';
import getLocalStorage from './localStorage';
import {
  getRememberPersistValue,
  migratePersistToRemember,
} from 'bootstrapping/migrate-persist-to-remember';

// Simple wrapper around localStorage to automagically parse and stringify payloads.
function setItem(key: string, value: unknown) {
  try {
    getLocalStorage().setItem(key, isString(value) ? value : JSON.stringify(value));
  } catch (e) {
    // Calculate used size and attach it to the error report. This is diagnostics
    // for https://sentry.io/nusmods/v3/issues/432778991/
    const usedSpace: Record<string, number> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (typeof k === 'string') {
          const item = localStorage.getItem(k);
          if (item) usedSpace[k] = Math.round(item.length / 1024);
        }
      }
    } catch (error) {
      // Ignore error
    }

    captureException(e, { usedSpace });
  }
}

export function rawGetItem(key: string): string | null {
  return getLocalStorage().getItem(key);
}

function getItem(key: string): unknown {
  const reduxRememberValue = rawGetItem(key);

  if (reduxRememberValue === null) {
    const reduxPersistValue = getRememberPersistValue(key);

    if (reduxPersistValue === null) return null;

    return migratePersistToRemember(reduxPersistValue);
  }

  try {
    return JSON.parse(reduxRememberValue);
  } catch (error) {
    captureException(error);
    return reduxRememberValue;
  }
}

function removeItem(key: string) {
  try {
    getLocalStorage().removeItem(key);
  } catch (e) {
    captureException(e);
  }
}

const storage = {
  setItem,
  getItem,
  removeItem,
};

export default storage;
